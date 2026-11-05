# API reference

The OpenAPI 3.1 spec lives at [`openapi.yaml`](openapi.yaml).

## Browsing with Swagger UI

```bash
docker run --rm -p 8088:8080 \
  -e SWAGGER_JSON=/docs/openapi.yaml \
  -v "$(pwd)/docs:/docs" \
  swaggerapi/swagger-ui
# Open http://localhost:8088
```

> **Authentication note:** All endpoints (except `/api/auth/login`, `/api/auth/logout`, and `/api/health`) require a valid session cookie set by `POST /api/auth/login`.
