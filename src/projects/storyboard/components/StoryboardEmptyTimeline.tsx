"use client";

const EMPTY_SLOT_COUNT = 6;

export function StoryboardEmptyTimeline() {
  return (
    <div
      className="sbw-playback is-workspace-timeline"
      data-testid="storyboard-empty-timeline"
      aria-label="分镜时间轴"
    >
      <div className="sbw-playback__workspace-timeline sbw-playback__workspace-timeline--empty">
        <div className="sbw-playback__empty-state">
          <div
            className="sbw-playback__shot-strip is-paged is-empty"
            aria-hidden
          >
            {Array.from({ length: EMPTY_SLOT_COUNT }, (_, index) => (
              <div key={index} className="sbw-playback__shot-slot">
                <div className="sbw-playback__shot-card is-empty" />
              </div>
            ))}
          </div>
          <p className="sbw-playback__empty-message" role="status">
            生成分镜后将显示时间轴
          </p>
        </div>
      </div>
    </div>
  );
}
