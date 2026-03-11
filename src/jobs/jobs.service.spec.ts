import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { QueueService } from '../queue/queue.service';

describe('JobsService', () => {
  let service: JobsService;
  let queueService: jest.Mocked<QueueService>;

  const enqueuedResult = { jobId: 'summarize-u1-123456789', status: 'queued' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobsService,
        {
          provide: QueueService,
          useValue: {
            enqueueJob: jest.fn().mockResolvedValue(enqueuedResult),
            getJobStatus: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<JobsService>(JobsService);
    queueService = module.get(QueueService);
  });

  // ── enqueueJob ───────────────────────────────────────────────────────────────

  describe('enqueueJob', () => {
    it('enqueues a summarize job', async () => {
      const result = await service.enqueueJob('summarize', { text: 'hello' }, 'u1', 't1');
      expect(result).toEqual(enqueuedResult);
      expect(queueService.enqueueJob).toHaveBeenCalledWith('summarize', { text: 'hello' }, 'u1', 't1');
    });

    it('enqueues an analyze job', async () => {
      await expect(
        service.enqueueJob('analyze', { text: 'data' }, 'u1', 't1'),
      ).resolves.not.toThrow();
    });

    it('enqueues a translate job', async () => {
      await expect(
        service.enqueueJob('translate', { text: 'hello', targetLang: 'French' }, 'u1', 't1'),
      ).resolves.not.toThrow();
    });

    it('throws BadRequestException for invalid job type', async () => {
      await expect(
        service.enqueueJob('delete-all-data', {}, 'u1', 't1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for empty job type', async () => {
      await expect(service.enqueueJob('', {}, 'u1', 't1')).rejects.toThrow(BadRequestException);
    });

    it('does not call queueService for invalid job types', async () => {
      await expect(service.enqueueJob('invalid', {}, 'u1', 't1')).rejects.toThrow();
      expect(queueService.enqueueJob).not.toHaveBeenCalled();
    });
  });

  // ── getJobStatus ─────────────────────────────────────────────────────────────

  describe('getJobStatus', () => {
    const mockJob = {
      id: 'job-1',
      data: { userId: 'u1', tenantId: 't1', payload: {} },
      status: 'completed',
    };

    it('returns job status for the owner', async () => {
      queueService.getJobStatus.mockResolvedValue(mockJob as any);
      const result = await service.getJobStatus('job-1', 'u1');
      expect(result).toEqual(mockJob);
    });

    it('throws NotFoundException when job does not exist', async () => {
      queueService.getJobStatus.mockResolvedValue(null as any);
      await expect(service.getJobStatus('ghost-job', 'u1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when job belongs to a different user', async () => {
      queueService.getJobStatus.mockResolvedValue(mockJob as any);
      await expect(service.getJobStatus('job-1', 'other-user')).rejects.toThrow(NotFoundException);
    });

    it('does not leak job existence to non-owners (throws same NotFoundException)', async () => {
      queueService.getJobStatus.mockResolvedValue(mockJob as any);
      const error = await service.getJobStatus('job-1', 'attacker').catch((e) => e);
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe('Job not found');
    });
  });
});
