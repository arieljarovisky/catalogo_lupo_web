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
