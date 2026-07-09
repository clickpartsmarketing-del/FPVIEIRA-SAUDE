// =====================================================================
// Edge Function: transcrever — áudio REAL estilo WhatsApp → texto
//
// Deploy:  painel Supabase > Edge Functions > Deploy new function
//          nome exato: transcrever  · cole este arquivo
// Secret:  Edge Functions > Secrets → adicione UM dos dois:
//          OPENAI_API_KEY  (usa gpt-4o-mini-transcribe, ~R$20/mês p/ 21h)
//          GROQ_API_KEY    (usa whisper-large-v3-turbo, ~R$5/mês — groq.com grátis)
// =====================================================================

Deno.serve(async (req: Request) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
  };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const form = await req.formData();
    const audio = form.get('audio') as File | null;
    if (!audio) return new Response(JSON.stringify({ erro: 'sem áudio' }), { status: 400, headers: cors });

    const groq = Deno.env.get('GROQ_API_KEY');
    const openai = Deno.env.get('OPENAI_API_KEY');

    let endpoint = '', token = '', model = '';
    if (groq) {
      endpoint = 'https://api.groq.com/openai/v1/audio/transcriptions';
      token = groq;
      model = 'whisper-large-v3-turbo';
    } else if (openai) {
      endpoint = 'https://api.openai.com/v1/audio/transcriptions';
      token = openai;
      model = 'gpt-4o-mini-transcribe';
    } else {
      return new Response(JSON.stringify({ erro: 'configure OPENAI_API_KEY ou GROQ_API_KEY nos Secrets' }), { status: 500, headers: cors });
    }

    const fd = new FormData();
    fd.append('file', audio, 'audio.webm');
    fd.append('model', model);
    fd.append('language', 'pt');

    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd
    });
    const j = await r.json();

    return new Response(JSON.stringify({ texto: j.text || '', provider: model }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ erro: String(e) }), { status: 500, headers: cors });
  }
});
