"use client";

import { useId } from "react";

export type EditorEpisodeView = {
  id: string;
  title: string;
  content: string;
};

type Props = {
  episode: EditorEpisodeView | null;
  hasSourceText?: boolean;
  splitStatus?: string;
  reviewMode?: boolean;
  disabled?: boolean;
  onContentChange: (content: string) => void;
};

export function ScriptDocumentEditor({
  episode,
  hasSourceText = false,
  splitStatus,
  reviewMode = false,
  disabled = false,
  onContentChange,
}: Props) {
  const fieldId = useId();

  return (
    <section className="scs-panel scs-panel--editor" aria-label="文本修正">
      <h2>{reviewMode ? "分集正文" : "文本修正"}</h2>

      {!episode ? (
        <div className="scs-status-card">
          <p className="scs-hint" style={{ margin: 0 }}>
            {hasSourceText && splitStatus !== "confirmed"
              ? "源文本已导入。请使用「分集」生成方案，在中间选择集数后于此处核对正文。"
              : "请在中间选择某一集后，在此阅读与修改正文。"}
          </p>
        </div>
      ) : (
        <div key={episode.id} className="scs-text-fade">
          <p className="scs-editor-ep-title">{episode.title}</p>
          <label htmlFor={fieldId} className="sr-only">
            {episode.title}正文
          </label>
          <textarea
            id={fieldId}
            className="scs-textarea is-doc"
            value={episode.content}
            disabled={disabled}
            onChange={(e) => onContentChange(e.target.value)}
            placeholder="这里显示剧本内容，可以直接修改"
          />
          <p className="scs-hint">
            {reviewMode
              ? "核对并修改后，点击下方「确认剧本」写入正式剧集。"
              : "修改后点击页头「保存页面」保存当前集文本。"}
          </p>
        </div>
      )}
    </section>
  );
}
