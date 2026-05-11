# GitHub Actions Workflows

This directory contains CI/CD workflows for the Chairbord Solar Inventory Backend

## Workflow Files

- **`ci.yml`** - Continuous Integration (type checking, building, security scanning)
- **`test.yml`** - Testing workflow (runs tests with database)
- **`deploy-staging.yml`** - Deploy to staging environment
- **`deploy-production.yml`** - Deploy to production environment
- **`docker-hub.yml`** - Build and push to Docker Hub

## Quick Start

1. **Configure Secrets**: Add required secrets in GitHub repository settings
2. **Push to Branch**: Workflows trigger automatically on push
3. **Monitor**: Check Actions tab for workflow status

## Workflow Triggers

| Workflow | Trigger |
|----------|---------|
| CI | Push/PR to `main` or `develop` |
| Test | Push/PR to `main` or `develop` |
| Deploy Staging | Push to `develop` or manual |
| Deploy Production | Push to `main`, tags `v*.*.*`, or manual |
| Docker Hub | Push to `main`, tags `v*.*.*`, or manual |

## Documentation

See [docs/GITHUB_ACTIONS.md](../docs/GITHUB_ACTIONS.md) for detailed documentation.



