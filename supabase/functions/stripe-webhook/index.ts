import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20', httpClient: Stripe.createFetchHttpClient() });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('No signature', { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;

  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return new Response(`Webhook error: ${e.message}`, { status: 400 });
  }

  switch (event.type) {

    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.supabase_user_id;
      const plan = session.metadata?.plan as string;

      if (!userId || !plan) break;

      if (plan === 'funeraria') {
        // Crear funeraria y vincular usuario si viene del onboarding
        const funerariaName = session.metadata?.funeraria_name || 'Funeraria';
        const customerEmail = session.customer_details?.email || '';

        const { data: fh } = await sb.from('funeral_homes').insert({
          name: funerariaName,
          email: customerEmail,
          stripe_customer_id: session.customer as string,
          stripe_subscription_id: session.subscription as string,
          plan_active: true,
          plan_started_at: new Date().toISOString(),
        }).select().single();

        if (fh) {
          await sb.from('funeral_home_users').upsert({
            id: userId,
            funeral_home_id: fh.id,
            role: 'admin',
          });
        }

        await sendConfirmationEmail(customerEmail, 'funeraria', funerariaName);
      } else {
        // Plan particular (premium_anticipado o premium_postumo)
        await sb.from('profiles').update({
          plan,
          plan_paid_at: new Date().toISOString(),
        }).eq('id', userId);

        const { data: profile } = await sb.from('profiles').select('email').eq('id', userId).single();
        if (profile?.email) {
          await sendConfirmationEmail(profile.email, plan);
        }
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      // Desactivar funeraria
      await sb.from('funeral_homes')
        .update({ plan_active: false })
        .eq('stripe_subscription_id', sub.id);
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      // Notificar al admin
      console.error(`Payment failed for subscription: ${invoice.subscription}`);
      break;
    }
  }

  return new Response(JSON.stringify({ received: true }), { headers: corsHeaders });
});

async function sendConfirmationEmail(email: string, plan: string, name?: string) {
  const labels: Record<string, string> = {
    premium_anticipado: 'Premium Anticipado',
    premium_postumo: 'Premium Póstumo',
    funeraria: 'Plan Funeraria',
  };

  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family:Georgia,serif;background:#FAF8F4;color:#1a1612;padding:40px 20px;">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid rgba(60,40,120,0.12);border-radius:4px;overflow:hidden;">
  <div style="background:#3D2D8F;padding:1.5rem;text-align:center;">
    <div style="font-size:1.8rem;font-weight:300;color:#fff;letter-spacing:0.1em;">memori</div>
  </div>
  <div style="padding:2rem 2.5rem;">
    <p style="font-size:1rem;color:#3D2D8F;font-weight:500;">Pago confirmado — ${labels[plan] || plan}</p>
    <p style="font-size:0.9rem;line-height:1.75;color:#4a443c;">
      ${name ? `Hola ${name},` : 'Hola,'}
    </p>
    <p style="font-size:0.9rem;line-height:1.75;color:#4a443c;">
      Tu pago se ha procesado correctamente. ${plan === 'funeraria'
        ? 'Ya puedes acceder al panel de funeraria en <a href="https://memori.mlorente.es/funeraria.html">memori.mlorente.es/funeraria.html</a>.'
        : 'Ya tienes acceso completo a todas las funcionalidades del plan ' + (labels[plan] || plan) + '.'
      }
    </p>
    <p style="font-size:0.9rem;line-height:1.75;color:#4a443c;">
      Gracias por confiar en Memori.
    </p>
  </div>
  <div style="padding:1rem 2.5rem;border-top:1px solid rgba(60,40,120,0.08);font-size:0.72rem;color:#8a8278;">
    Memori — hola@memori.mlorente.es
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
      from: 'Memori <hola@memori.mlorente.es>',
      to: [email],
      subject: `Confirmación de pago — ${labels[plan] || plan}`,
      html,
    }),
  });
}
