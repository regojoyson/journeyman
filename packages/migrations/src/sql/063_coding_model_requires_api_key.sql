-- 063_coding_model_requires_api_key.sql
-- The typed config.apiKeySlot label is replaced by an explicit boolean
-- config.requiresApiKey. The env-var label is now derived at run time, so the
-- stored apiKeySlot is dropped. Any model that previously declared a key slot is
-- marked as requiring a key.

UPDATE jm_coding_models
   SET config = (coalesce(config, '{}'::jsonb) - 'apiKeySlot')
                || '{"requiresApiKey": true}'::jsonb
 WHERE coalesce(config->>'apiKeySlot', '') <> '';
