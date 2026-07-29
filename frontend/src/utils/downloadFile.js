/**
 * Progressive-enhancement download helper.
 * Chromium (HTTPS): native Save As picker when available.
 * Safari/Firefox / picker failure: standard anchor download (unchanged).
 */
export async function downloadFile(blob, suggestedFilename, mimeType = 'text/csv') {
  if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
    try {
      const extension = String(suggestedFilename).includes('.')
        ? String(suggestedFilename).split('.').pop()
        : 'bin';
      const handle = await window.showSaveFilePicker({
        suggestedName: suggestedFilename,
        types: [
          {
            description: `${String(extension).toUpperCase()} file`,
            accept: { [mimeType]: [`.${extension}`] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { method: 'picker', success: true };
    } catch (err) {
      if (err?.name === 'AbortError') {
        return { method: 'picker', success: false, cancelled: true };
      }
      console.warn('[downloadFile] Picker failed, falling back:', err);
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedFilename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { method: 'anchor', success: true };
}
