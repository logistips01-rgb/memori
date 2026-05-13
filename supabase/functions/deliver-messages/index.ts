import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const FROM_EMAIL = 'mensajes@memori.mlorente.es';

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const today = new Date().toISOString().split('T')[0];

    // Mensajes con fecha de entrega = hoy o anterior, aún pendientes
    const { data: messages, error } = await sb
      .from('messages')
      .select('*, profiles(name, email)')
      .eq('delivery_type', 'fecha')
      .eq('status', 'pending')
      .lte('delivery_date', today);

    if (error) throw error;
    if (!messages?.length) return new Response(JSON.stringify({ delivered: 0 }), { headers: corsHeaders });

    let delivered = 0;

    for (const msg of messages) {
      try {
        const fileUrl = await getSignedUrl(msg.storage_path);
        await sendDeliveryEmail({
          senderName: msg.profiles?.name || 'Alguien especial',
          recipientEmail: msg.recipient_email,
          recipientName: msg.recipient_name,
          messageTitle: msg.title,
          format: msg.format,
          fileUrl,
          content: msg.content,
        });

        await sb.from('messages').update({
          status: 'delivered',
          delivered_at: new Date().toISOString(),
        }).eq('id', msg.id);

        delivered++;
      } catch (e) {
        console.error(`Error delivering message ${msg.id}:`, e);
      }
    }

    return new Response(JSON.stringify({ delivered }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
});

async function getSignedUrl(storagePath: string | null): Promise<string | null> {
  if (!storagePath) return null;
  const { data } = await sb.storage.from('messages').createSignedUrl(storagePath, 60 * 60 * 24 * 30); // 30 días
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
}) {
  const formatLabel: Record<string, string> = { video: 'vídeo', audio: 'audio', texto: 'texto' };
  const fmtLabel = formatLabel[opts.format] ?? opts.format;

  const bodyHtml = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><style>
  body { font-family: Georgia, serif; background: #FAF8F4; color: #1a1612; margin: 0; padding: 0; }
  .wrap { max-width: 560px; margin: 40px auto; background: #fff; border: 1px solid rgba(60,40,120,0.12); border-radius: 4px; overflow: hidden; }
  .header { background: #3D2D8F; padding: 2rem; text-align: center; }
  .logo { font-size: 2rem; font-weight: 300; color: #fff; letter-spacing: 0.1em; }
  .tagline { font-size: 0.75rem; color: rgba(255,255,255,0.5); margin-top: 0.25rem; letter-spacing: 0.1em; }
  .body { padding: 2rem 2.5rem; }
  .saludo { font-size: 1.1rem; color: #3D2D8F; margin-bottom: 1.25rem; }
  p { font-size: 0.9rem; line-height: 1.75; color: #4a443c; margin-bottom: 1rem; }
  .msg-card { border: 1px solid rgba(60,40,120,0.12); border-radius: 3px; padding: 1.25rem 1.5rem; margin: 1.5rem 0; background: #EEEDFE; }
  .msg-title { font-size: 1rem; font-weight: 500; color: #3D2D8F; margin-bottom: 0.25rem; }
  .msg-fmt { font-size: 0.72rem; color: #7F77DD; text-transform: uppercase; letter-spacing: 0.08em; }
  .btn { display: inline-block; background: #3D2D8F; color: #fff; padding: 0.8rem 2rem; border-radius: 2px; text-decoration: none; font-size: 0.85rem; font-family: sans-serif; font-weight: 500; margin: 1rem 0; }
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
    <div class="saludo">Un mensaje para ti, ${opts.recipientName}</div>
    <p>${opts.senderName} dejó guardado este mensaje para entregártelo hoy.</p>
    <div class="msg-card">
      <div class="msg-title">${opts.messageTitle}</div>
      <div class="msg-fmt">Formato: ${fmtLabel}</div>
    </div>
    ${opts.content ? `<div class="text-content">${opts.content.replace(/\n/g, '<br>')}</div>` : ''}
    ${opts.fileUrl ? `<p style="text-align:center;"><a href="${opts.fileUrl}" class="btn">Abrir mensaje →</a></p><p style="font-size:0.75rem;color:#8a8278;">Este enlace es válido durante 30 días.</p>` : ''}
    <p>Este mensaje fue creado con cariño y guardado en <strong>Memori</strong>, una plataforma de legado digital.</p>
  </div>
  <div class="footer">
    Recibes este email porque alguien designó tu dirección como destinataria de un mensaje personal.<br>
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
      subject: `${opts.senderName} te ha dejado un mensaje`,
      html: bodyHtml,
    }),
  });

  if (!res.ok) throw new Error(`Resend error: ${await res.text()}`);
}
