import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!;
const BASE_URL = Deno.env.get('BASE_URL') || 'https://memori.mlorente.es';

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20', httpClient: Stripe.createFetchHttpClient() });

interface CheckoutPayload {
  plan: 'premium_anticipado' | 'premium_postumo' | 'funeraria';
  funeraria_name?: string;
}

const PRICES: Record<string, { amount: number; mode: 'payment' | 'subscription'; label: string }> = {
  premium_anticipado: { amount: 5900, mode: 'payment', label: 'Memori Premium Anticipado' },
  premium_postumo:    { amount: 9900, mode: 'payment', label: 'Memori Premium Póstumo' },
  funeraria:          { amount: 2900, mode: 'subscription', label: 'Memori Plan Funeraria' },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401, headers: corsHeaders });

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !user) return new Response(JSON.stringify({ error: 'Token inválido' }), { status: 401, headers: corsHeaders });

  const body: CheckoutPayload = await req.json();
  const priceConfig = PRICES[body.plan];
  if (!priceConfig) return new Response(JSON.stringify({ error: 'Plan no válido' }), { status: 400, headers: corsHeaders });

  // Obtener o crear customer de Stripe
  const { data: profile } = await sb.from('profiles').select('stripe_customer_id, name, email').eq('id', user.id).single();
  let customerId = profile?.stripe_customer_id;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email!,
      name: profile?.name || undefined,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;
    await sb.from('profiles').update({ stripe_customer_id: customerId }).eq('id', user.id);
  }

  const successUrl = `${BASE_URL}/panel.html?payment=success&plan=${body.plan}`;
  const cancelUrl = `${BASE_URL}/panel.html?payment=cancelled`;

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    customer: customerId,
    mode: priceConfig.mode,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      supabase_user_id: user.id,
      plan: body.plan,
    },
    payment_method_types: ['card', 'bizum', 'sepa_debit'],
    locale: 'es',
    line_items: [{
      price_data: {
        currency: 'eur',
        product_data: { name: priceConfig.label },
        unit_amount: priceConfig.amount,
        ...(priceConfig.mode === 'subscription' ? { recurring: { interval: 'month' } } : {}),
      },
      quantity: 1,
    }],
  };

  if (body.plan === 'funeraria' && body.funeraria_name) {
    sessionParams.metadata!.funeraria_name = body.funeraria_name;
  }

  const session = await stripe.checkout.sessions.create(sessionParams);

  return new Response(JSON.stringify({ url: session.url }), { headers: corsHeaders });
});
