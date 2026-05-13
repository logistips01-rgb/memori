# Memori — Guía de puesta en marcha

## Servicios necesarios (todos tienen tier gratuito para empezar)

| Servicio | Qué hace | Tier gratuito |
|---|---|---|
| [Supabase](https://supabase.com) | BD, Auth, Storage, Edge Functions | 500MB DB, 1GB Storage |
| [Stripe](https://stripe.com) | Pagos (tarjeta, Bizum, transferencia) | Sin cuota fija |
| [Resend](https://resend.com) | Emails transaccionales | 3.000/mes |

---

## Paso 1 — Supabase

### 1.1 Crear proyecto
1. Ve a [supabase.com](https://supabase.com) → New project
2. Región: **Frankfurt (eu-central-1)** — más cercano a España
3. Anota: `Project URL` y `anon public key` (Settings > API)

### 1.2 Ejecutar la migración
En el SQL Editor de Supabase, abre y ejecuta:
```
supabase/migrations/001_schema.sql
```

### 1.3 Configurar Auth con Google
1. Supabase Dashboard → Authentication → Providers → Google
2. En [Google Cloud Console](https://console.cloud.google.com):
   - Crea un proyecto → APIs & Services → Credentials → OAuth 2.0 Client ID
   - Authorized redirect URIs: `https://YOUR_PROJECT.supabase.co/auth/v1/callback`
3. Pega Client ID y Secret en Supabase

### 1.4 Conectar dominio en Supabase Auth
- Authentication > URL Configuration > Site URL: `https://memori.mlorente.es`
- Redirect URLs: añade `https://memori.mlorente.es/panel.html`

### 1.5 Actualizar las 3 páginas HTML
En `panel.html`, `funeraria.html` e `index.html`, reemplaza:
```js
const SUPABASE_URL  = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON = 'YOUR_ANON_KEY';
```
con los valores reales de tu proyecto.

---

## Paso 2 — Stripe

### 2.1 Crear cuenta en stripe.com

### 2.2 Activar métodos de pago españoles
Dashboard → Settings → Payment methods:
- ✅ Cards
- ✅ **Bizum** (disponible en España, actívalo manualmente)
- ✅ SEPA Direct Debit (transferencia)

### 2.3 Configurar webhook
1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. URL: `https://YOUR_PROJECT.supabase.co/functions/v1/stripe-webhook`
3. Eventos a escuchar:
   - `checkout.session.completed`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Anota el **Webhook signing secret** (`whsec_...`)

---

## Paso 3 — Resend

1. Crea cuenta en [resend.com](https://resend.com)
2. Verifica tu dominio `memori.mlorente.es` (añade los registros DNS que te indiquen)
3. Crea API Key → anótala (`re_...`)

---

## Paso 4 — Desplegar Edge Functions

### Instalar Supabase CLI
```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

### Configurar variables de entorno
```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=eyJ...
supabase secrets set STRIPE_SECRET_KEY=sk_live_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
supabase secrets set RESEND_API_KEY=re_...
supabase secrets set BASE_URL=https://memori.mlorente.es
```

### Desplegar las 4 funciones
```bash
supabase functions deploy deliver-messages
supabase functions deploy notify-death
supabase functions deploy create-checkout
supabase functions deploy stripe-webhook
```

---

## Paso 5 — Panel de funeraria: crear usuarios staff

Para dar acceso a una funeraria:

1. En Supabase → Authentication → Users → Invite user (con el email de la funeraria)
2. Cuando el usuario acepte la invitación, en el SQL Editor ejecuta:

```sql
-- Primero crear la funeraria (o usa el ID ya creado por Stripe webhook si ya pagó)
INSERT INTO funeral_homes (name, email, plan_active)
VALUES ('Funeraria Ejemplo', 'info@funerariaejemplo.com', true);

-- Luego vincular el usuario staff
INSERT INTO funeral_home_users (id, funeral_home_id, role)
VALUES (
  (SELECT id FROM auth.users WHERE email = 'info@funerariaejemplo.com'),
  (SELECT id FROM funeral_homes WHERE email = 'info@funerariaejemplo.com'),
  'admin'
);
```

---

## Paso 6 — Desplegar el sitio

El proyecto son 3 archivos HTML estáticos. Opciones:

### GitHub Pages (más sencillo, ya tienes CNAME configurado)
```bash
git push origin main
```
Activa GitHub Pages en Settings → Pages → Branch: main

### Vercel / Netlify
Arrastra la carpeta del proyecto o conecta el repo.

---

## Checklist de lanzamiento

- [ ] Supabase proyecto creado y migración ejecutada
- [ ] Google OAuth configurado
- [ ] `SUPABASE_URL` y `SUPABASE_ANON` actualizados en los 3 HTML
- [ ] Stripe cuenta activa, Bizum activado
- [ ] Webhook de Stripe apuntando a la Edge Function
- [ ] Resend dominio verificado
- [ ] Edge Functions desplegadas con sus secrets
- [ ] Sitio publicado en memori.mlorente.es
- [ ] Prueba completa: registro → crear mensaje → pago → entrega
- [ ] Primera funeraria onboarded como usuario staff
