document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('err');
  err.innerHTML = '';
  const res = await fetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: document.getElementById('u').value,
      password: document.getElementById('p').value,
      remember: document.getElementById('r').checked,
    }),
  });
  if (res.ok) {
    const next = new URLSearchParams(location.search).get('next');
    location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
    return;
  }
  const data = await res.json().catch(() => ({}));
  const box = document.createElement('div');
  box.className = 'errbox';
  box.setAttribute('role', 'alert');
  box.textContent = data.error?.message || 'Sign-in failed.';
  err.appendChild(box);
});
