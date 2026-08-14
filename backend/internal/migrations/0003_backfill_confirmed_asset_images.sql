-- Older confirmations created the library row but left its image metadata
-- empty. A non-empty libraryAssetId is the durable per-item confirmation
-- marker (the parent record may still be in review). The generated blob
-- already uses generatedMedia.currentId as its storage key.
do $$
declare
  bundle_row record;
  design_value jsonb;
  design_record jsonb;
  design_item jsonb;
  original_bundle jsonb;
  next_bundle jsonb;
  next_assets jsonb;
  asset_group text;
  asset_id text;
  media_id text;
  media_mime text;
begin
  for bundle_row in
    select namespace, document_key, revision, value
    from app_documents
    where namespace = 'asset-bundles'
    for update
  loop
    select value
    into design_value
    from app_documents
    where namespace = 'episode-asset-designs'
      and document_key = bundle_row.document_key;

    if design_value is null then
      continue;
    end if;

    original_bundle := bundle_row.value;
    next_bundle := original_bundle;

    for design_record in
      select record_entry
      from jsonb_array_elements(
        case
          when jsonb_typeof(design_value -> 'records') = 'array'
            then design_value -> 'records'
          else '[]'::jsonb
        end
      ) with ordinality as records(record_entry, ordinal)
      order by coalesce(record_entry ->> 'confirmedAt', '') desc, ordinal desc
    loop
      for design_item in
        select item_entry
        from jsonb_array_elements(
          case
            when jsonb_typeof(design_record -> 'items') = 'array'
              then design_record -> 'items'
            else '[]'::jsonb
          end
        ) as items(item_entry)
      loop
        asset_id := btrim(coalesce(design_item ->> 'libraryAssetId', ''));
        media_id := btrim(coalesce(design_item #>> '{generatedMedia,currentId}', ''));
        asset_group := case design_item ->> 'assetType'
          when 'character' then 'characters'
          when 'scene' then 'scenes'
          when 'prop' then 'props'
          else null
        end;

        if asset_id = '' or media_id = '' or asset_group is null then
          continue;
        end if;

        media_mime := null;
        select nullif(history_entry ->> 'mimeType', '')
        into media_mime
        from jsonb_array_elements(
          case
            when jsonb_typeof(design_item #> '{generatedMedia,history}') = 'array'
              then design_item #> '{generatedMedia,history}'
            else '[]'::jsonb
          end
        ) as history(history_entry)
        where history_entry ->> 'mediaId' = media_id
        limit 1;
        media_mime := coalesce(
          media_mime,
          nullif(design_item #>> '{generatedMedia,mimeType}', ''),
          'image/png'
        );

        select coalesce(
          jsonb_agg(
            case
              when asset ->> 'id' = asset_id
                and btrim(coalesce(asset ->> 'imageFileName', '')) = ''
              then asset || jsonb_build_object(
                'imageFileName', media_id,
                'imageMimeType', media_mime,
                'primaryMediaId', media_id,
                'approvedMediaIds',
                  case
                    when jsonb_typeof(asset -> 'approvedMediaIds') = 'array'
                      and asset -> 'approvedMediaIds' @> jsonb_build_array(media_id)
                    then asset -> 'approvedMediaIds'
                    when jsonb_typeof(asset -> 'approvedMediaIds') = 'array'
                    then asset -> 'approvedMediaIds' || jsonb_build_array(media_id)
                    else jsonb_build_array(media_id)
                  end,
                'status', 'completed'
              )
              else asset
            end
            order by ordinal
          ),
          '[]'::jsonb
        )
        into next_assets
        from jsonb_array_elements(
          case
            when jsonb_typeof(next_bundle -> asset_group) = 'array'
              then next_bundle -> asset_group
            else '[]'::jsonb
          end
        ) with ordinality as assets(asset, ordinal);

        next_bundle := jsonb_set(
          next_bundle,
          array[asset_group],
          next_assets,
          true
        );
      end loop;
    end loop;

    if next_bundle is distinct from original_bundle then
      next_bundle := jsonb_set(
        next_bundle,
        '{updatedAt}',
        to_jsonb(current_timestamp),
        true
      );
      update app_documents
      set value = next_bundle,
          revision = revision + 1,
          updated_at = now()
      where namespace = bundle_row.namespace
        and document_key = bundle_row.document_key
        and revision = bundle_row.revision;
    end if;
  end loop;
end
$$;
