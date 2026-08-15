"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { Review } from "@wanaflow/db";
import { AtSign, CheckCircle2, GitPullRequestArrow, MessageCircle, Send, X } from "lucide-react";
import { Button } from "@wanaflow/ui";

import { addReviewComment, resolveReviewComment } from "@/lib/api-client";

type CommentAnchor = { id: string; name: string; type: string } | null;

export function StudioComments({
  open,
  review,
  selected,
  onClose,
  onRequestReview,
  onReviewChange,
  onAnchorSelect,
}: {
  open: boolean;
  review: Review | null;
  selected: CommentAnchor;
  onClose: () => void;
  onRequestReview: () => void;
  onReviewChange: (review: Review) => void;
  onAnchorSelect: (elementId: string) => void;
}) {
  const [body, setBody] = useState("");
  const [mentionedPrincipalIds, setMentionedPrincipalIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const participants = useMemo(() => {
    if (!review) return [];
    const candidates = [
      review.requestedBy,
      review.revision.createdBy,
      ...review.assignments.map((assignment) => assignment.reviewer),
    ];
    return [...new Map(candidates.map((person) => [person.id, person])).values()];
  }, [review]);

  if (!open) return null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!review || !selected || !body.trim()) return;
    setPending(true);
    setError(null);
    try {
      const next = await addReviewComment(review.id, {
        elementId: selected.id,
        body: body.trim(),
        mentionedPrincipalIds,
      });
      onReviewChange(next);
      setBody("");
      setMentionedPrincipalIds([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The comment could not be added.");
    } finally {
      setPending(false);
    }
  };

  const resolve = async (commentId: string) => {
    if (!review) return;
    setPending(true);
    setError(null);
    try {
      onReviewChange(await resolveReviewComment(review.id, commentId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The comment could not be resolved.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[var(--overlay-28)] backdrop-blur-[2px]" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !pending) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="studio-comments-title" className="flex h-full w-full max-w-[420px] flex-col border-l border-[var(--line)] bg-[var(--paper-raised)] shadow-[-24px_0_70px_rgba(27,26,23,0.14)]">
        <header className="flex items-start justify-between border-b border-[var(--line)] px-6 py-5">
          <div>
            <p className="section-label">Review discussion</p>
            <h2 id="studio-comments-title" className="mt-1.5 text-lg font-semibold">Comments in context</h2>
            <p className="mt-2 text-[0.6875rem] leading-5 text-[var(--muted-ink)]">Every note stays attached to an exact BPMN element and pinned revision.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close comments" className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius)] hover:bg-[var(--wash)]"><X className="size-4" /></button>
        </header>

        {!review ? (
          <div className="flex flex-1 flex-col justify-center px-8">
            <span className="flex size-10 items-center justify-center rounded-[var(--radius)] bg-[var(--signal-wash)] text-[var(--signal)]"><GitPullRequestArrow className="size-4" /></span>
            <h3 className="mt-5 text-base font-semibold">Discussion begins with a review.</h3>
            <p className="mt-2 text-xs leading-5 text-[var(--muted-ink)]">Save the draft, invite an independent reviewer, then keep every question anchored here in Studio.</p>
            <Button variant="signal" className="mt-6 self-start" onClick={onRequestReview}><GitPullRequestArrow className="size-3.5" /> Request review</Button>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-auto">
              <div className="border-b border-[var(--line)] px-6 py-4 text-[0.6875rem] text-[var(--muted-ink)]">
                Revision {review.revision.number} · {review.comments.filter((comment) => !comment.resolvedAt).length} open
              </div>
              {review.comments.length ? (
                <ol className="divide-y divide-[var(--line)] px-6">
                  {review.comments.map((comment) => (
                    <li key={comment.id} className={`py-5 ${comment.resolvedAt ? "opacity-55" : ""}`}>
                      <button type="button" onClick={() => onAnchorSelect(comment.elementId)} className="font-mono text-[0.6rem] font-semibold text-[var(--signal)]">{comment.elementName} · {comment.elementId}</button>
                      <p className="mt-2 text-xs leading-5">{comment.body}</p>
                      {comment.mentions.length ? <p className="mt-2 flex flex-wrap gap-1.5">{comment.mentions.map((mention) => <span key={mention.id} className="rounded-full bg-[var(--signal-wash)] px-2 py-1 text-[0.55rem] font-semibold text-[var(--signal)]">@{mention.displayName}</span>)}</p> : null}
                      <div className="mt-3 flex items-center justify-between text-[0.6rem] text-[var(--faint-ink)]">
                        <span>{comment.author.displayName}</span>
                        {comment.resolvedAt ? <span className="flex items-center gap-1 text-[var(--moss)]"><CheckCircle2 className="size-3" /> Resolved</span> : review.capabilities.canComment ? <button type="button" disabled={pending} onClick={() => void resolve(comment.id)} className="font-semibold text-[var(--moss)]">Resolve</button> : null}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="px-8 py-14 text-center">
                  <MessageCircle className="mx-auto size-5 text-[var(--faint-ink)]" />
                  <p className="mt-4 text-sm font-semibold">No discussion yet.</p>
                  <p className="mt-2 text-[0.6875rem] leading-5 text-[var(--muted-ink)]">Select a process element and leave the first precise note.</p>
                </div>
              )}
            </div>

            {review.status === "OPEN" && review.capabilities.canComment ? (
              <form onSubmit={submit} className="border-t border-[var(--line)] px-6 py-5">
                <p className="text-[0.625rem] font-semibold text-[var(--muted-ink)]">{selected ? `Commenting on ${selected.name}` : "Select an element on the canvas first"}</p>
                <label htmlFor="studio-review-comment" className="sr-only">Studio review comment</label>
                <textarea id="studio-review-comment" value={body} onChange={(event) => setBody(event.target.value)} rows={3} maxLength={4000} placeholder="What should the team understand here?" className="mt-3 w-full resize-none rounded-[var(--radius)] border border-[var(--line-strong)] bg-transparent p-3 text-xs leading-5 outline-none placeholder:text-[var(--faint-ink)] focus:border-[var(--signal)]" />
                <div className="mt-3 flex flex-wrap items-center gap-1.5"><AtSign className="size-3 text-[var(--faint-ink)]" />{participants.map((person) => { const active = mentionedPrincipalIds.includes(person.id); return <button key={person.id} type="button" onClick={() => setMentionedPrincipalIds((current) => active ? current.filter((id) => id !== person.id) : [...current, person.id])} className={`rounded-full px-2 py-1 text-[0.55rem] font-semibold ${active ? "bg-[var(--signal-wash)] text-[var(--signal)]" : "bg-[var(--wash)] text-[var(--muted-ink)]"}`}>{person.displayName}</button>; })}</div>
                {error ? <p role="alert" className="mt-3 text-[0.6875rem] text-[var(--danger)]">{error}</p> : null}
                <div className="mt-4 flex justify-end"><Button type="submit" variant="signal" size="sm" disabled={pending || !selected || !body.trim()}><Send className="size-3.5" /> Add comment</Button></div>
              </form>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
