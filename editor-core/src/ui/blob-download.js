/** 保存中だけ DOM と Blob URL を所有する。import 時の DOM 操作はない。 */
export function downloadBlobSafely23({ filename, blob }, environment = globalThis) {
  const doc = environment.document, Url = environment.URL;
  let url, anchor, releaseScheduled = false;
  const release = () => { try { if (url) Url.revokeObjectURL(url); } catch { /* 元の保存失敗を上書きしない */ } };
  try {
    url = Url.createObjectURL(blob);
    anchor = doc.createElement('a');
    anchor.href = url; anchor.download = filename; anchor.style.display = 'none';
    doc.body.appendChild(anchor);
    anchor.click();
    // 保存の開始直後に URL を無効にしない。失敗した場合だけ finally で即時解放。
    environment.setTimeout(release, 5000);
    releaseScheduled = true;
  } finally {
    if (anchor) {
      try { anchor.remove(); }
      catch { try { anchor.parentNode?.removeChild(anchor); } catch { /* 後始末は可能な範囲で行う */ } }
    }
    if (!releaseScheduled) release();
  }
}
