// Accept the existing n8n text response as well as common JSON response shapes.
export function extractAnswer(raw) {
  let data;
  try { data = JSON.parse(raw); } catch { return { answer: raw.trim(), citations: [] }; }
  if (Array.isArray(data)) data = data[0];
  if (typeof data === 'string') return { answer: data.trim(), citations: [] };
  if (!data || typeof data !== 'object') return { answer: '', citations: [] };
  if (data.error || data.status === 'failed' || data.status === 'incomplete') {
    throw new Error('The assistant could not complete its answer. Check the latest n8n execution.');
  }
  if (Array.isArray(data.output)) {
    const parts = data.output.filter(item => item.type === 'message' && item.role === 'assistant')
      .flatMap(item => item.content || []);
    const answer = parts.filter(part => part.type === 'output_text').map(part => part.text || '').join('\n\n')
      || parts.filter(part => part.type === 'refusal').map(part => part.refusal || '').join('\n\n');
    const references = parts.flatMap(part => part.annotations || [])
      .filter(item => item.type === 'file_citation' || item.type === 'url_citation')
      .map(item => ({ title: item.filename || item.title || 'Reference', url: item.type === 'url_citation' && /^https?:\/\//i.test(item.url || '') ? item.url : null }));
    const citations = [...new Map(references.map(item => [item.url || item.title, item])).values()];
    return { answer: answer.trim(), citations };
  }
  for (const key of ['answer', 'output_text', 'response', 'text', 'message']) {
    if (typeof data[key] === 'string') return { answer: data[key].trim(), citations: [] };
  }
  return { answer: '', citations: [] };
}
