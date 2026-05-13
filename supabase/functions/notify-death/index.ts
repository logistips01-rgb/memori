import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const FROM_EMAIL = 'mensajes@memori.mlorente.es';

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface DeathPayload {
  user_id: string;
  death_date: string;
  guardian_name: string;
  guardian_contact: string;
  plan_type: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Verificar que es staff de funeraria
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401, headers: corsHeaders });

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !user) return new Response(JSON.stringify({ error: 'Token inválido' }), { status: 401, headers: corsHeaders });

  // Verificar que es staff de funeraria
  const { data: staffRow } = await sb
    .from('funeral_home_users')
    .select('funeral_home_id')
    .eq('id', user.id)
    .single();

  if (!staffRow) return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 403, headers: corsHeaders });

  try {
    const body: DeathPayload = await req.json();
    const { user_id, death_date, guardian_name, guardian_contact, plan_type } = body;

    if (!user_id || !death_date) {
      return new Response(JSON.stringify({ error: 'Faltan campos obligatorios' }), { status: 400, headers: corsHeaders });
    }

    // 1. Marcar perfil como fallecido
    await sb.from('profiles').update({ status: 'deceased' }).eq('id', user_id);

    // 2. Registrar notificación de fallecimiento
    const paymentStatus = plan_type === 'premium_postumo' ? 'pending' : 'not_required';
    const { data: notification, error: notifErr } = await sb
      .from('death_notifications')
      .insert({
        user_id,
        funeral_home_id: staffRow.funeral_home_id,
        death_date,
        guardian_name,
        guardian_contact,
        plan_type,
        payment_status: paymentStatus,
        messages_released: false,
      })
      .select()
      .single();

    if (notifErr) throw notifErr;

    // 3. Obtener todos los mensajes de despedida del usuario
    const { data: farewellMessages } = await sb
      .from('messages')
      .select('*')
      .eq('user_id', user_id)
      .eq('delivery_type', 'despedida')
      .eq('status', 'pending');

    // 4. Obtener nombre del fallecido
    const { data: profile } = await sb
      .from('profiles')
      .select('name, email')
      .eq('id', user_id)
      .single();

    const senderName = profile?.name || 'Un ser querido';

    // 5. Enviar mensajes de despedida
    let released = 0;
    for (const msg of (farewellMessages || [])) {
      try {
        const fileUrl = await getSignedUrl(msg.storage_path);
        await sendDeliveryEmail({
          senderName,
          recipientEmail: msg.recipient_email,
          recipientName: msg.recipient_name,
          messageTitle: msg.title,
          format: msg.format,
          fileUrl,
          content: msg.content,
          isFarewell: true,
        });

        await sb.from('messages').update({
          status: 'delivered',
          delivered_at: new Date().toISOString(),
        }).eq('id', msg.id);

        released++;
      } catch (e) {
        console.error(`Error releasing farewell message ${msg.id}:`, e);
      }
    }

    // 6. Marcar notificación como mensajes liberados
    await sb.from('death_notifications')
      .update({ messages_released: true })
      .eq('id', notification.id);

    // 7. Notificar al guardián si hay mensajes por evento sin fecha
    const { data: eventMessages } = await sb
      .from('messages')
      .select('count')
      .eq('user_id', user_id)
      .eq('delivery_type', 'evento')
      .eq('status', 'pending');

    if (guardian_contact && guardian_contact.includes('@')) {
      await notifyGuardian({
        guardianEmail: guardian_contact,
        guardianName: guardian_name,
        senderName,
        eventMsgCount: (eventMessages as any)?.[0]?.count ?? 0,
      });
    }

    return new Response(JSON.stringify({ success: true, messages_released: released }), {
      headers: corsHeaders,
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
});

async function getSignedUrl(storagePath: string | null): Promise<string | null> {
  if (!storagePath) return null;
  const { data } = await sb.storage.from('messages').createSignedUrl(storagePath, 60 * 60 * 24 * 365);
  return data?.signedUrl ?? null;
}

async function sendDeliveryEmail(opts: {
  senderName: string;
  recipientEmail: string;
  recipientName: string;
  messageTitle: string;
  format: string;
  fileUrl: string | null;
  content: string | null;
  isFarewell: boolean;
}) {
  const formatLabel: Record<string, string> = { video: 'vídeo', audio: 'audio', texto: 'texto' };
  const fmtLabel = formatLabel[opts.format] ?? opts.format;

  const bodyHtml = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><style>
  body { font-family: Georgia, serif; background: #FAF8F4; color: #1a1612; margin: 0; padding: 0; }
  .wrap { max-width: 560px; margin: 40px auto; background: #fff; border: 1px solid rgba(60,40,120,0.12); border-radius: 4px; overflow: hidden; }
  .header { background: #1a1612; padding: 2rem; text-align: center; }
  .logo { font-size: 2rem; font-weight: 300; color: #fff; letter-spacing: 0.1em; }
  .tagline { font-size: 0.75rem; color: rgba(255,255,255,0.35); margin-top: 0.25rem; letter-spacing: 0.1em; }
  .body { padding: 2rem 2.5rem; }
  .saludo { font-size: 1.1rem; color: #1a1612; margin-bottom: 1.25rem; }
  p { font-size: 0.9rem; line-height: 1.75; color: #4a443c; margin-bottom: 1rem; }
  .msg-card { border: 1px solid rgba(60,40,120,0.12); border-radius: 3px; padding: 1.25rem 1.5rem; margin: 1.5rem 0; background: #FAF8F4; }
  .msg-title { font-size: 1rem; font-weight: 500; color: #1a1612; margin-bottom: 0.25rem; }
  .msg-fmt { font-size: 0.72rem; color: #8a8278; text-transform: uppercase; letter-spacing: 0.08em; }
  .btn { display: inline-block; background: #1a1612; color: #fff; padding: 0.8rem 2rem; border-radius: 2px; text-decoration: none; font-size: 0.85rem; font-family: sans-serif; font-weight: 500; margin: 1rem 0; }
  .text-content { background: #FAF8F4; border-left: 3px solid #C4A882; padding: 1.25rem 1.5rem; font-style: italic; line-height: 1.8; color: #4a443c; }
  .footer { padding: 1.25rem 2.5rem; border-top: 1px solid rgba(60,40,120,0.08); font-size: 0.72rem; color: #8a8278; line-height: 1.6; }
</style></head>
<body>
<div class="wrap">
  <div class="header">
    <div class="logo">memori</div>
    <div class="tagline">Porque algunas palabras merecen llegar</div>
  </div>
  <div class="body">
    <div class="saludo">${opts.recipientName},</div>
    <p>${opts.senderName} preparó este mensaje para ti. Quería que lo recibieras.</p>
    <div class="msg-card">
      <div class="msg-title">${opts.messageTitle}</div>
      <div class="msg-fmt">Formato: ${fmtLabel}</div>
    </div>
    ${opts.content ? `<div class="text-content">${opts.content.replace(/\n/g, '<br>')}</div>` : ''}
    ${opts.fileUrl ? `<p style="text-align:center;"><a href="${opts.fileUrl}" class="btn">Abrir mensaje →</a></p><p style="font-size:0.75rem;color:#8a8278;text-align:center;">Este enlace es válido durante 1 año.</p>` : ''}
  </div>
  <div class="footer">
    Este mensaje fue guardado con antelación en <strong>Memori</strong>, plataforma de legado digital.<br>
    Si tienes dudas, escríbenos a hola@memori.mlorente.es
  </div>
</div>
</body></html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `Memori <${FROM_EMAIL}>`,
      to: [opts.recipientEmail],
      subject: `${opts.senderName} te dejó un mensaje`,
      html: bodyHtml,
    }),
  });

  if (!res.ok) throw new Error(`Resend error: ${await res.text()}`);
}

async function notifyGuardian(opts: {
  guardianEmail: string;
  guardianName: string;
  senderName: string;
  eventMsgCount: number;
}) {
  if (!opts.eventMsgCount) return;

  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family:Georgia,serif;background:#FAF8F4;color:#1a1612;padding:40px 20px;">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid rgba(60,40,120,0.12);border-radius:4px;overflow:hidden;">
  <div style="background:#1a1612;padding:1.5rem;text-align:center;">
    <div style="font-size:1.8rem;font-weight:300;color:#fff;letter-spacing:0.1em;">memori</div>
  </div>
  <div style="padding:2rem 2.5rem;">
    <p style="font-size:0.9rem;line-height:1.75;color:#4a443c;">Hola ${opts.guardianName},</p>
    <p style="font-size:0.9rem;line-height:1.75;color:#4a443c;">
      Has sido designado/a guardián/a de los mensajes de <strong>${opts.senderName}</strong> en Memori.
    </p>
    <p style="font-size:0.9rem;line-height:1.75;color:#4a443c;">
      Hay <strong>${opts.eventMsgCount} mensaje${opts.eventMsgCount !== 1 ? 's' : ''} por evento</strong> pendiente${opts.eventMsgCount !== 1 ? 's' : ''} que dependen de tu activación.
      Estos mensajes están programados para entregarse en momentos específicos de la vida de sus destinatarios.
    </p>
    <p style="font-size:0.9rem;line-height:1.75;color:#4a443c;">
      Contacta con nosotros en <a href="mailto:hola@memori.mlorente.es">hola@memori.mlorente.es</a> para recibir instrucciones y acceso a estos mensajes.
    </p>
  </div>
</div>
</body></html>`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `Memori <${FROM_EMAIL}>`,
      to: [opts.guardianEmail],
      subject: `Eres guardián de los mensajes de ${opts.senderName}`,
      html,
    }),
  });
}
