# BEES Sync

Aplicacion web para convertir la primera hoja de un Excel al formato `ITEMS v2`, validar el contenido, solicitar acceso a BEES y enviar el lote a produccion.

## Requisitos

- Node.js 22.13 o posterior
- Credenciales vigentes de BEES para el vendor

## Configuracion local

1. Instala dependencias con `npm install`.
2. Duplica `.env.example` como `.env.local` y completa los valores.
3. Inicia la aplicacion con `npm run dev`.
4. Abre `http://localhost:3000`.

Las credenciales se usan solo en las rutas del servidor. El navegador nunca recibe el `client_secret` ni el token de acceso.

## Columnas del Excel

La primera hoja debe incluir: `sku`, `name`, `brandId`, `brandName`, `subBrandName`, `isAlcoholic`, `isNarcotic`, `category`, `packageName`, `packageItemCount`, `containerName`, `containerSize`, `containerUnitOfMeasurement` y `containerReturnable`.

Los SKU se normalizan a 18 digitos con ceros a la izquierda. Los campos booleanos aceptan `TRUE/FALSE`, `VERDADERO/FALSO`, `SI/NO` y `1/0`.

## Flujo

1. El navegador lee y valida el Excel.
2. `POST /api/bees/check` comprueba las credenciales contra el endpoint de token.
3. `POST /api/bees/send` solicita un token nuevo y ejecuta el `PUT` de `ITEMS v2`.

No se requieren cookies de sesion de BEES ni se almacena el bearer token.
