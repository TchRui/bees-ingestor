# BEES Sync

Aplicación privada para validar archivos Excel con el contrato `ITEMS v2`, seleccionar una concesión MKP desde PostgreSQL y enviar los SKUs a BEES en bloques secuenciales de 50.

## Configuración

Requiere Node.js 22.13 o posterior y estas variables del servidor:

- `DATABASE_URL`: conexión TLS a PostgreSQL.
- `DB_CA_CERT`: certificado CA PEM (admite `\n` escapados) o `system` si la CA ya es confiable para el sistema.
- `BEES_ENVIRONMENT=PROD`: entorno autorizado para consultar credenciales.
- `SITE_URL`: URL pública usada por los metadatos.

El navegador recibe únicamente `{vendorId, name}`. `client_secret`, URLs privadas, token y conexión PostgreSQL permanecen en el servidor.

## Columnas del Excel

Obligatorias: `sku`, `name`, `brandId`, `packageId`, `packageName`, `packageCount`, `packageItemCount`, `containerName`, `containerSize`, `containerUnitOfMeasurement` y `containerReturnable`.

Opcionales: `brandName`, `subBrandName`, `isAlcoholic`, `isNarcotic`, `packagePack`, `packageSize`, `packageUnitOfMeasurement`, `volumeM3`, `weightKG`, `containerMaterial`, `convertedSize` y `convertedSizeUnit`.

Los SKU se normalizan a 18 dígitos. Los booleanos aceptan `TRUE/FALSE`, `VERDADERO/FALSO`, `SI/NO`, `YES` y `1/0`. `category` se ignora con una advertencia. `convertedSize` y `convertedSizeUnit` deben aparecer juntos.

## Flujo

1. El navegador lee la primera hoja, transforma los datos y muestra errores o advertencias.
2. `GET /api/concessions` consulta concesiones con credenciales PROD completas.
3. `POST /api/bees/send` vuelve a consultar las credenciales, obtiene un token y envía bloques de 50 en orden.
4. Los errores 4xx de validación permiten continuar; `401`, `403`, `429`, errores de red y `5xx` detienen los bloques pendientes.
5. La respuesta lista cada `requestTraceId` y genera el enlace filtrado de BEES One.

No se hacen reintentos automáticos de `PUT`. Una respuesta `2xx` significa que BEES aceptó el bloque para procesamiento, no que completó la ingestión.

## Desarrollo

```bash
npm install
npm run dev
npm test
```

Las pruebas simulan PostgreSQL y BEES; no realizan envíos reales.
