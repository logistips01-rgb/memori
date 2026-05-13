import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Sin autorización');

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await sb.auth.getUser();
    if (authError || !user) throw new Error('Usuario no autenticado');

    const { mensaje_id } = await req.json();
    if (!mensaje_id) throw new Error('mensaje_id requerido');

    const { data: mensaje, error: msgError } = await sb
      .from('mensajes')
      .select('*')
      .eq('id', mensaje_id)
      .eq('user_id', user.id)
      .single();

    if (msgError || !mensaje) throw new Error('Mensaje no encontrado');
    if (!mensaje.email_destinatario) throw new Error('El mensaje no tiene email de destinatario');

    const tipoLabel: Record<string, string> = {
      evento: 'un evento especial',
      fecha: 'la fecha que eligió',
      despedida: 'su partida',
    };

    const formatoTexto = mensaje.formato === 'texto'
      ? `<div style="background:#f9f7f4;border-left:3px solid #C4A882;padding:1.5rem;margin:1.5rem 0;font-style:italic;color:#4a443c;">${mensaje.contenido_texto}</div>`
      : `<p style="color:#8a8278;font-size:0.9rem;">Este mensaje incluye un ${mensaje.formato === 'video' ? 'vídeo' : 'audio'}. Puedes verlo/escucharlo en el panel de Memori.</p>`;

    const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#FAF8F4;font-family:'Georgia',serif;">
  <div style="max-width:560px;margin:2rem auto;background:#fff;border:1px solid rgba(60,40,120,0.12);border-radius:4px;overflow:hidden;">
    <div style="background:#3D2D8F;padding:2rem;text-align:center;">
      <div style="font-family:Georgia,serif;font-size:2rem;font-weight:300;color:#fff;letter-spacing:0.1em;">Memori</div>
      <div style="font-size:0.75rem;color:rgba(255,255,255,0.5);letter-spacing:0.1em;margin-top:0.3rem;">MENSAJES QUE TRASCIENDEN</div>
    </div>
    <div style="padding:2.5rem;">
      <p style="color:#8a8278;font-size:0.85rem;margin-bottom:0.5rem;">Un mensaje para ti</p>
      <h1 style="font-family:Georgia,serif;font-size:1.6rem;font-weight:300;color:#3D2D8F;margin:0 0 0.5rem;">${mensaje.titulo}</h1>
      <p style="color:#8a8278;font-size:0.85rem;margin-bottom:2rem;">
        Alguien que te quería guardó este mensaje esperando ${tipoLabel[mensaje.tipo_entrega] || 'este momento'}.
      </p>
      ${formatoTexto}
      ${mensaje.nota_guardian ? `<div style="margin-top:1.5rem;padding:1rem;background:#EEEDFE;border-radius:3px;font-size:0.82rem;color:#3D2D8F;"><strong>Nota del guardián:</strong> ${mensaje.nota_guardian}</div>` : ''}
    </div>
    <div style="padding:1rem 2.5rem 2rem;text-align:center;color:#8a8278;font-size:0.75rem;border-top:1px solid rgba(60,40,120,0.08);">
      Memori · memori.mlorente.es
    </div>
  </div>
</body>
</html>`;

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Memori <mensajes@memori.mlorente.es>',
        to: [mensaje.email_destinatario],
        subject: `${mensaje.titulo} — un mensaje para ti`,
        html,
      }),
    });

    if (!resendRes.ok) {
      const err = await resendRes.json();
      throw new Error(err.message || 'Error al enviar email');
    }

    const sbAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    await sbAdmin.from('mensajes').update({ estado: 'enviado' }).eq('id', mensaje_id);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
