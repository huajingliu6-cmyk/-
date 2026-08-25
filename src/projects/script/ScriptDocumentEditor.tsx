"use client";

import { useId, type RefObject } from "react";

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
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  onBlur?: () => void;
  onContentChange: (content: string) => void;
};

export function ScriptDocumentEditor({
  episode,
  hasSourceText = false,
  splitStatus,
  reviewMode = false,
  disabled = false,
  textareaRef,
  onBlur,
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
              ? "源文本已导入。上传成功后将自动分集；在中间选择集数后于此处阅读正文。"
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
            ref={textareaRef}
            id={fieldId}
            className="scs-textarea is-doc"
            value={episode.content}
            disabled={disabled}
            onChange={(e) => onContentChange(e.target.value)}
            onBlur={() => onBlur?.()}
            placeholder="这里显示剧本内容，可以直接修改"
          />
          <p className="scs-hint">
            {reviewMode
              ? "核对后可修改正文；上传已自动创建剧集，点击下方「确认剧本」进入资产设计。"
              : "修改后点击其他区域将自动保存当前集文本。"}
          </p>
        </div>
      )}
    </section>
  );
}
