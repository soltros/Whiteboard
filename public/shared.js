const shareId = window.location.pathname.split('/').pop();

async function loadNote(password = null) {
  try {
    const response = password
      ? await fetch(`/api/shared/${shareId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        })
      : await fetch(`/api/shared/${shareId}`);
    const data = await response.json();

    if (!response.ok) {
      if (data.passwordRequired) {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('password-modal').classList.add('active');
        return;
      }
      throw new Error(data.error || 'Failed to load note');
    }

    document.getElementById('loading').style.display = 'none';
    document.getElementById('password-modal').classList.remove('active');
    const noteData = data.data || data;
    document.getElementById('note-container').style.display = 'block';
    document.getElementById('note-title').textContent = noteData.title || 'Untitled';
    const updatedDate = new Date(noteData.updatedAt).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
    document.getElementById('note-meta').textContent = `Last updated ${updatedDate}`;

    const contentDiv = document.getElementById('note-content');
    if (noteData.markdown) {
      contentDiv.innerHTML = DOMPurify.sanitize(marked.parse(noteData.markdown), { USE_PROFILES: { html: true } });
    } else {
      contentDiv.textContent = 'This note is empty.';
    }
    document.title = `${noteData.title || 'Untitled'} - Shared Note`;
  } catch (error) {
    console.error('Error loading note:', error);
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error').textContent = error.message;
    document.getElementById('error').style.display = 'block';
  }
}

function submitPassword() {
  const password = document.getElementById('password-input').value;
  if (!password) {
    document.getElementById('password-error').textContent = 'Please enter a password';
    document.getElementById('password-error').style.display = 'block';
    return;
  }
  document.getElementById('password-error').style.display = 'none';
  document.getElementById('loading').style.display = 'block';
  document.getElementById('password-modal').classList.remove('active');
  loadNote(password);
}

document.getElementById('unlock-button').addEventListener('click', submitPassword);
document.getElementById('password-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    submitPassword();
  }
});
loadNote();
