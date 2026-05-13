import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});

Deno.serve(async (req) => {
  const body = await req.text();
  const sig  = req.headers.get('stripe-signature') ?? '';

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      sig,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!,
    );
  } catch (err) {
    return new Response(`Webhook error: ${err.message}`, { status: 400 });
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.user_id;
    if (userId) {
      await sb.from('profiles').update({ plan: 'premium' }).eq('id', userId);
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription;
    const customerId = sub.customer as string;
    const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
    const userId = customer.metadata?.user_id;
    if (userId) {
      await sb.from('profiles').update({ plan: 'basico' }).eq('id', userId);
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
