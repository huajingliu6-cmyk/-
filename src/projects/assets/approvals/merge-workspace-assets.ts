import type {
  AudioAsset,
  CharacterAsset,
  ProjectAssetBundle,
  PropAsset,
  SceneAsset,
} from "@/projects/assets/types";
import { mergeMediaIdLists } from "@/projects/assets/episode-design/generated-media-history";

type ImageableAsset = CharacterAsset | SceneAsset | PropAsset;

function mergeImageableById(
  local: ImageableAsset[],
  upstream: ImageableAsset[],
): ImageableAsset[] {
  const map = new Map<string, ImageableAsset>();
  for (const item of upstream) {
    map.set(item.id, item);
  }
  for (const item of local) {
    const upstreamItem = map.get(item.id);
    if (!upstreamItem) {
      map.set(item.id, item);
      continue;
    }
    const approvedMediaIds = mergeMediaIdLists(
      item.approvedMediaIds,
      upstreamItem.approvedMediaIds,
    );
    const primaryMediaId =
      item.primaryMediaId ?? upstreamItem.primaryMediaId ?? null;
    const imageFileName =
      item.imageFileName ?? upstreamItem.imageFileName ?? null;
    const approvalProvenance =
      item.approvalProvenance ?? upstreamItem.approvalProvenance ?? null;
    map.set(item.id, {
      ...upstreamItem,
      ...item,
      ...(approvedMediaIds.length > 0 ? { approvedMediaIds } : {}),
      ...(primaryMediaId ? { primaryMediaId } : {}),
      ...(imageFileName ? { imageFileName } : {}),
      ...(approvalProvenance ? { approvalProvenance } : {}),
    });
  }
  return [...map.values()];
}

function mergeAudioById(local: AudioAsset[], upstream: AudioAsset[]): AudioAsset[] {
  const map = new Map<string, AudioAsset>();
  for (const item of upstream) map.set(item.id, item);
  for (const item of local) map.set(item.id, { ...map.get(item.id), ...item } as AudioAsset);
  return [...map.values()];
}

/**
 * Merge management/upstream approved assets into workspace local so local
 * override cannot hide newly promoted library rows.
 */
export function mergeAssetBundlesPreferLocalKeepUpstream(
  local: ProjectAssetBundle,
  upstream: ProjectAssetBundle,
): ProjectAssetBundle {
  return {
    projectId: local.projectId || upstream.projectId,
    characters: mergeImageableById(
      local.characters,
      upstream.characters,
    ) as CharacterAsset[],
    scenes: mergeImageableById(local.scenes, upstream.scenes) as SceneAsset[],
    props: mergeImageableById(local.props, upstream.props) as PropAsset[],
    audios: mergeAudioById(local.audios, upstream.audios),
  };
}
