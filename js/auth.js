const form = document.getElementById('loginForm');
const errorEl = document.getElementById('loginError');
const submitBtn = document.getElementById('loginSubmit');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.hidden = true;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Ingresando...';
  try {
    const data = await fetch('/api/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('username').value,
        password: document.getElementById('password').value
      })
    }).then(async res => {
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'No se pudo ingresar');
      return json;
    });
    window.location.href = data.user?.role === 'admin' ? '/admin' : '/';
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
    submitBtn.disabled = false;
    submitBtn.textContent = 'Ingresar';
  }
});

// Link "Pedilo por WhatsApp": usa el número público si el servidor lo expone.
(async () => {
  const link = document.getElementById('loginWhatsapp');
  if (!link) return;
  try {
    const res = await fetch('/api/public-config', { credentials: 'include' });
    if (!res.ok) return;
    const cfg = await res.json();
    const num = String(cfg.whatsappNumber || '').replace(/\D/g, '');
    if (!num) return;
    const text = encodeURIComponent(cfg.contactMessage || 'Hola! Quiero un usuario para ver los precios del catálogo mayorista Lupo.');
    link.href = `https://wa.me/${num}?text=${text}`;
    link.target = '_blank';
    link.rel = 'noopener';
  } catch {}
})();
