export type ScriptDownstreamPipelinePhase =
  | "not_started"
  | "assets_not_extracted"
  | "extracting_assets"
  | "assets_pending_selection"
  | "generating_storyboard"
  | "ready";

export type ScriptDownstreamPipelineStatus = {
  phase: ScriptDownstreamPipelinePhase;
  canEnterStoryboard: boolean;
  message: string;
  episodesTotal: number;
  episodesWithStoryboard: number;
  episodesGenerating: number;
  extractingAssets: boolean;
};
