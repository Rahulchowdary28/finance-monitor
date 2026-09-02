import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const { record } = await req.json()
  
  console.log(`Working on: ${record.description}`);

  // 1. Logic to pick category
  let newCat = "Shopping";
  const desc = record.description.toLowerCase();
  
  if (desc.includes("kfc") || desc.includes("food") || desc.includes("mcdonald")) newCat = "Food";
  if (desc.includes("uber") || desc.includes("taxi")) newCat = "Transport";

  // 2. Connect to Database
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // 3. Perform the Update
  const { error } = await supabase
    .from('transactions')
    .update({ category: newCat })
    .eq('id', record.id);

  if (error) {
    console.error("Database error:", error);
    return new Response(JSON.stringify(error), { status: 500 });
  }

  console.log(`Successfully updated to: ${newCat}`);
  return new Response(JSON.stringify({ success: true, category: newCat }), {
    headers: { "Content-Type": "application/json" },
  });
})
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // 1. Get spending from the last 7 days
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const { data: transactions } = await supabase
    .from('transactions')
    .select('*')
    .gte('created_at', weekAgo.toISOString())

  const total = transactions?.reduce((sum, t) => sum + t.amount, 0) || 0

  // 2. Send the Email via Resend
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'FinanceBot <onboarding@resend.dev>',
      to: ['rahulchowdary8@outlook.com'], // CHANGE THIS TO YOUR EMAIL
      subject: '📊 Your Weekly Financial Health Report',
      html: `
        <h1>Weekly Summary</h1>
        <p>Total Spent: <strong>$${total}</strong></p>
        <p>Transactions: ${transactions?.length || 0}</p>
        <hr>
        <p>Stay disciplined!</p>
      `
    })
  })

  return new Response(JSON.stringify({ sent: true }), { status: 200 })
})