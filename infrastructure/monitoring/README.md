# Monitoring Stack

This stack gives the project a local or staging observability baseline.

Included services:
- Prometheus for metrics
- Grafana for dashboards
- Loki for logs
- Promtail for Docker log shipping
- Node Exporter for host metrics
- cAdvisor for container metrics

Run everything from the backend repo:

```bash
docker compose up -d
```

Useful URLs:
- API: `http://localhost:3000`
- Frontend: `http://localhost:3001`
- Grafana: `http://localhost:3002`
- Prometheus: `http://localhost:9090`
- Loki: `http://localhost:3100`
- cAdvisor: `http://localhost:8080`

Default Grafana login:

```text
admin / admin
```

Change the Grafana password before using this outside local development.

The Prometheus config expects the API to expose `/metrics`. If that endpoint is not enabled yet, Prometheus will show the `stream-api` target as down while host and container metrics still work.
