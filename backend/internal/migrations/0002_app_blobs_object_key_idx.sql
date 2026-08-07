create index if not exists app_blobs_object_key_idx on app_blobs(object_key) where object_key is not null;
