# Local SSDB 1.9.9

This directory builds SSDB from the official `ideawu/ssdb` repository at tag `1.9.9`, fixed to commit `3e556e4bf4cee96d2577e3c3002f00c540e4ba10`.

The image is for isolated local development only. It is not an operations-approved production image, and SSDB must remain a disposable cache rather than a persistent fact source.

## Start

From the repository root:

```powershell
docker-compose -p ic-ssdb-199-local -f deploy/compose.local-ssdb.yml up -d --build
```

The service has no published host port. Other containers must join the internal Compose network and use `ssdb:8888`.

## Inspect

```powershell
docker-compose -p ic-ssdb-199-local -f deploy/compose.local-ssdb.yml ps
docker-compose -p ic-ssdb-199-local -f deploy/compose.local-ssdb.yml logs --tail=100 ssdb
```

## Stop

Preserve the disposable local cache volume:

```powershell
docker-compose -p ic-ssdb-199-local -f deploy/compose.local-ssdb.yml down
```

Remove the disposable local cache volume as well:

```powershell
docker-compose -p ic-ssdb-199-local -f deploy/compose.local-ssdb.yml down -v
```

The upstream `1.9.9` tag still contains `version` value `1.9.8`, so startup logs display `ssdb-server 1.9.8`. Provenance is established by the fixed Git commit and OCI image labels, not by that stale startup string.
