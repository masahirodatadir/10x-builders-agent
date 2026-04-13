# Integración con Notion

Guía para configurar una **integración pública** de Notion con OAuth, variables de entorno y uso del agente (búsqueda y lectura de páginas).

---

## 1. Crear la integración en Notion

1. Abre [My integrations](https://www.notion.so/my-integrations) (Notion → Settings → Connections → Develop or manage integrations).

2. Crea una integración nueva y elige tipo **Public** (integración pública).

3. En **OAuth**, registra la **Redirect URI** exacta que usará tu app, por ejemplo:
   - Desarrollo: `http://localhost:3000/api/integrations/notion/callback`
   - Producción: `https://tu-dominio.com/api/integrations/notion/callback`

   Debe coincidir con la URL a la que Notion redirige tras autorizar. Si el `origin` de tu servidor no es fiable (proxy, túnel), define `NOTION_REDIRECT_URI` en el entorno con esa URL completa.

4. En **Capabilities**, habilita al menos **Read content** (solo lectura para las tools actuales: búsqueda y texto de página).

5. Completa los datos de distribución que exija Notion y guarda. Copia **OAuth client ID** y **OAuth client secret**.

---

## 2. Variables de entorno

En `apps/web/.env.local` (plantilla en `apps/web/.env.example`):

```env
NOTION_CLIENT_ID=tu-client-id
NOTION_CLIENT_SECRET=tu-client-secret

# Misma clave que para GitHub OAuth (AES-256-GCM, 64 hex)
OAUTH_ENCRYPTION_KEY=tu-clave-de-64-caracteres-hex

# Opcional: forzar callback si origin HTTP no coincide
# NOTION_REDIRECT_URI=http://localhost:3000/api/integrations/notion/callback
```

---

## 3. Cómo accede el agente a tus páginas

Notion **no** expone todo el workspace automáticamente. El usuario debe:

1. Conectar Notion desde **Ajustes** en la web (flujo OAuth).
2. En el asistente de Notion, **elegir qué páginas o bases de datos** compartir con la integración (o añadir la conexión desde el menú **••• → Connections** en cada página).

Solo el contenido compartido aparecerá en `notion_search` y podrá leerse con `notion_get_page_text`.

---

## 4. Tokens (access + refresh)

Tras el OAuth, el servidor guarda en `user_integrations` un **JSON cifrado** con `access_token` y `refresh_token`. Notion puede **rotar** el refresh token en cada renovación; el código actualiza la fila tras un refresh exitoso.

Si varias peticiones refrescan a la vez, en casos raros puede fallar con `invalid_grant`: el usuario puede volver a conectar desde Ajustes.

---

## 5. Herramientas del agente

| Tool | Uso |
|------|-----|
| `notion_search` | Buscar páginas/bases de datos accesibles por la integración. |
| `notion_get_page_text` | Leer el texto de una página (árbol de bloques, con límites de tamaño). |

Límites aproximados en lectura: profundidad de bloques, número de bloques y caracteres totales se recortan para no saturar el contexto del modelo; la respuesta indica `truncated` cuando aplica.

---

## 6. Referencia de API

- [Authorization (OAuth)](https://developers.notion.com/docs/authorization)
- [Search](https://developers.notion.com/reference/post-search)
- [Retrieve block children](https://developers.notion.com/reference/get-block-children)

Usar el header `Notion-Version` alineado con el del código (p. ej. `2026-03-11`).
