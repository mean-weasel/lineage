import type { ContentPost } from '../../shared/types';

export function ContentPostPreview({
  onCopy,
  post,
}: {
  onCopy: (text: string, label: string) => Promise<void>;
  post: ContentPost;
}) {
  return (
    <aside className="post-preview" aria-label="Post markdown preview">
      <div>
        <strong>{post.title}</strong>
        <p>{post.channel} · {post.phase} · {post.source_path || 'manual post'}</p>
      </div>
      <button className="text-button" onClick={() => void onCopy(post.body || '', 'post markdown')} type="button">Copy markdown</button>
      <pre>{post.body || 'No markdown body saved for this post yet.'}</pre>
    </aside>
  );
}
