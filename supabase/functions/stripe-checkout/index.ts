import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});

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

    const { data: { user }, error } = await sb.auth.getUser();
    if (error || !user) throw new Error('Usuario no autenticado');

    const body = req.headers.get('content-type')?.includes('application/json')
      ? await req.json() : {};
    const priceId = body.price_id || Deno.env.get('STRIPE_PRICE_ID')!;

    // Determinar modo según el price (suscripciones vs pago único)
    const priceInfo = await stripe.prices.retrieve(priceId);
    const mode = priceInfo.recurring ? 'subscription' : 'payment';

    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: 'https://memori.mlorente.es/panel.html?pago=ok',
      cancel_url:  'https://memori.mlorente.es/panel.html?pago=cancelado',
      customer_email: user.email,
      metadata: { user_id: user.id },
      subscription_data: mode === 'subscription' ? { metadata: { user_id: user.id } } : undefined,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
