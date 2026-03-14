CREATE TYPE public.agent_task_status AS ENUM (
    'pending',
    'running',
    'completed',
    'failed',
    'cancelled'
);

CREATE TYPE public.assistant_type AS ENUM (
    'prompt',
    'webhook'
);

CREATE TYPE public.user_plan AS ENUM (
    'free',
    'pro',
    'enterprise'
);

CREATE TABLE public.admin_audit_logs (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    actor_user_id character varying,
    target_user_id character varying NOT NULL,
    action text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.agent_memories (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    category text NOT NULL,
    content text NOT NULL,
    source text,
    relevance_score integer DEFAULT 50,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.agent_tasks (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    status public.agent_task_status DEFAULT 'pending'::public.agent_task_status NOT NULL,
    input jsonb,
    output jsonb,
    error text,
    conversation_id character varying,
    progress integer DEFAULT 0,
    started_at timestamp without time zone,
    completed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.assistants (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    type public.assistant_type DEFAULT 'prompt'::public.assistant_type NOT NULL,
    user_id character varying,
    name text NOT NULL,
    description text,
    prompt_content text,
    webhook_url text,
    workflow_id text,
    metadata jsonb,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.chats (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    user_id character varying NOT NULL,
    project_id character varying,
    title text NOT NULL,
    model text DEFAULT 'compound'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.cron_jobs (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    user_id character varying NOT NULL,
    name text NOT NULL,
    cron_expression text NOT NULL,
    prompt text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    recurring boolean DEFAULT true NOT NULL,
    conversation_id character varying,
    last_run_at timestamp without time zone,
    next_run_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.knowledge_items (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    user_id character varying NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    source_url text,
    file_name text,
    file_type text,
    file_size text,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.messages (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    chat_id character varying NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    attachments jsonb,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.oauth_tokens (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    user_id character varying NOT NULL,
    provider text NOT NULL,
    access_token text NOT NULL,
    refresh_token text,
    token_expiry timestamp without time zone,
    scopes text[],
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    account_label text DEFAULT 'default'::text NOT NULL
);

CREATE TABLE public.output_templates (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    description text,
    format text NOT NULL,
    instructions text,
    required_sections jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.password_reset_tokens (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    user_id character varying NOT NULL,
    token character varying NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    used text DEFAULT 'false'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.platform_settings (
    id character varying NOT NULL,
    data jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    version integer DEFAULT 1 NOT NULL
);

CREATE TABLE public.platform_settings_history (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    version integer NOT NULL,
    data jsonb NOT NULL,
    changed_by character varying,
    changed_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.pro_coupon_redemptions (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    coupon_id character varying NOT NULL,
    user_id character varying NOT NULL,
    redeemed_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.pro_coupons (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    label text,
    description text,
    max_redemptions integer,
    redemption_count integer DEFAULT 0 NOT NULL,
    expires_at timestamp without time zone,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.project_files (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    project_id character varying NOT NULL,
    file_name text NOT NULL,
    file_type text NOT NULL,
    file_size text NOT NULL,
    file_url text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.project_knowledge (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    project_id character varying NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    source_url text,
    file_name text,
    file_type text,
    file_size text,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.projects (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    user_id character varying NOT NULL,
    name text NOT NULL,
    description text,
    custom_instructions text,
    include_global_knowledge text DEFAULT 'false'::text NOT NULL,
    include_user_memories text DEFAULT 'false'::text NOT NULL,
    share_token character varying,
    is_public text DEFAULT 'false'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.reactions (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    message_id character varying NOT NULL,
    user_id character varying NOT NULL,
    type text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.releases (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    version integer NOT NULL,
    label text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    change_notes text,
    system_prompt_id character varying,
    assistant_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    template_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    output_template_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    tool_policy_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    published_at timestamp without time zone,
    published_by_user_id character varying,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.system_prompts (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    version integer NOT NULL,
    label text,
    content text NOT NULL,
    notes text,
    created_by_user_id character varying,
    activated_by_user_id character varying,
    is_active boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    activated_at timestamp without time zone
);

CREATE TABLE public.templates (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    file_id character varying NOT NULL,
    file_name text NOT NULL,
    mime_type text NOT NULL,
    file_size integer NOT NULL,
    available_for_free boolean DEFAULT false NOT NULL,
    available_for_pro boolean DEFAULT true NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.tool_error_logs (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    tool_name text NOT NULL,
    error text NOT NULL,
    args jsonb,
    conversation_id character varying,
    created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.tool_policies (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    tool_name text NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    safety_note text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.usage_metrics (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    user_id character varying NOT NULL,
    chat_id character varying NOT NULL,
    message_id character varying,
    model text NOT NULL,
    prompt_tokens bigint DEFAULT 0 NOT NULL,
    completion_tokens bigint DEFAULT 0 NOT NULL,
    total_tokens bigint DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.usage_summary_snapshots (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    user_id character varying NOT NULL,
    range_start timestamp without time zone NOT NULL,
    range_end timestamp without time zone NOT NULL,
    totals jsonb NOT NULL,
    model_breakdown jsonb NOT NULL,
    generated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.user_api_keys (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    user_id character varying NOT NULL,
    provider text NOT NULL,
    api_key text NOT NULL,
    api_key_last_four text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.user_preferences (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    user_id character varying NOT NULL,
    personalization_enabled text DEFAULT 'false'::text NOT NULL,
    custom_instructions text,
    name text,
    occupation text,
    about_me text,
    profile_image_url text,
    memories jsonb DEFAULT '[]'::jsonb,
    chat_history_enabled text DEFAULT 'true'::text NOT NULL,
    autonomous_code_execution text DEFAULT 'true'::text NOT NULL,
    last_area text DEFAULT 'user'::text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    ai_name text DEFAULT 'Melvin'::text,
    ai_avatar_url text,
    multi_agent_enabled text DEFAULT 'true'::text NOT NULL,
    ai_can_create_subagents text DEFAULT 'false'::text NOT NULL,
    enabled_skills jsonb DEFAULT '[]'::jsonb,
    company text,
    timezone text,
    location text,
    website text
);

CREATE TABLE public.users (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    username text,
    password text,
    email text,
    avatar text,
    first_name text,
    last_name text,
    profile_image_url text,
    plan public.user_plan DEFAULT 'free'::public.user_plan NOT NULL,
    pro_access_code text,
    role text DEFAULT 'user'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);

ALTER TABLE ONLY public.admin_audit_logs
    ADD CONSTRAINT admin_audit_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.agent_memories
    ADD CONSTRAINT agent_memories_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.agent_tasks
    ADD CONSTRAINT agent_tasks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.assistants
    ADD CONSTRAINT assistants_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.cron_jobs
    ADD CONSTRAINT cron_jobs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.knowledge_items
    ADD CONSTRAINT knowledge_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.oauth_tokens
    ADD CONSTRAINT oauth_tokens_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.oauth_tokens
    ADD CONSTRAINT oauth_tokens_user_id_provider_label_unique UNIQUE (user_id, provider, account_label);

ALTER TABLE ONLY public.output_templates
    ADD CONSTRAINT output_templates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_token_unique UNIQUE (token);

ALTER TABLE ONLY public.platform_settings_history
    ADD CONSTRAINT platform_settings_history_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.platform_settings
    ADD CONSTRAINT platform_settings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.pro_coupon_redemptions
    ADD CONSTRAINT pro_coupon_redemptions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.pro_coupons
    ADD CONSTRAINT pro_coupons_code_unique UNIQUE (code);

ALTER TABLE ONLY public.pro_coupons
    ADD CONSTRAINT pro_coupons_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.project_files
    ADD CONSTRAINT project_files_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.project_knowledge
    ADD CONSTRAINT project_knowledge_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_share_token_unique UNIQUE (share_token);

ALTER TABLE ONLY public.reactions
    ADD CONSTRAINT reactions_message_id_user_id_unique UNIQUE (message_id, user_id);

ALTER TABLE ONLY public.reactions
    ADD CONSTRAINT reactions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.releases
    ADD CONSTRAINT releases_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.releases
    ADD CONSTRAINT releases_version_key UNIQUE (version);

ALTER TABLE ONLY public.system_prompts
    ADD CONSTRAINT system_prompts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.system_prompts
    ADD CONSTRAINT system_prompts_version_key UNIQUE (version);

ALTER TABLE ONLY public.templates
    ADD CONSTRAINT templates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.tool_error_logs
    ADD CONSTRAINT tool_error_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.tool_policies
    ADD CONSTRAINT tool_policies_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.pro_coupon_redemptions
    ADD CONSTRAINT unique_coupon_user UNIQUE (coupon_id, user_id);

ALTER TABLE ONLY public.usage_metrics
    ADD CONSTRAINT usage_metrics_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.usage_summary_snapshots
    ADD CONSTRAINT usage_summary_snapshots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.usage_summary_snapshots
    ADD CONSTRAINT usage_summary_snapshots_window_idx UNIQUE (user_id, range_start, range_end);

ALTER TABLE ONLY public.user_api_keys
    ADD CONSTRAINT user_api_keys_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_api_keys
    ADD CONSTRAINT user_api_keys_user_id_provider_unique UNIQUE (user_id, provider);

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_user_id_unique UNIQUE (user_id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

CREATE INDEX admin_audit_logs_action_idx ON public.admin_audit_logs USING btree (action);

CREATE INDEX admin_audit_logs_target_user_idx ON public.admin_audit_logs USING btree (target_user_id);

CREATE INDEX agent_memories_category_idx ON public.agent_memories USING btree (category);

CREATE INDEX agent_tasks_conversation_idx ON public.agent_tasks USING btree (conversation_id);

CREATE INDEX agent_tasks_status_idx ON public.agent_tasks USING btree (status);

CREATE INDEX assistants_active_idx ON public.assistants USING btree (is_active);

CREATE INDEX assistants_type_idx ON public.assistants USING btree (type);

CREATE INDEX assistants_user_id_idx ON public.assistants USING btree (user_id);

CREATE UNIQUE INDEX assistants_user_workflow_idx ON public.assistants USING btree (user_id, workflow_id);

CREATE INDEX chats_project_id_idx ON public.chats USING btree (project_id);

CREATE INDEX chats_user_id_idx ON public.chats USING btree (user_id);

CREATE INDEX cron_jobs_enabled_idx ON public.cron_jobs USING btree (enabled);

CREATE INDEX cron_jobs_user_idx ON public.cron_jobs USING btree (user_id);

CREATE INDEX knowledge_items_user_id_idx ON public.knowledge_items USING btree (user_id);

CREATE INDEX messages_chat_id_idx ON public.messages USING btree (chat_id);

CREATE INDEX output_templates_category_idx ON public.output_templates USING btree (category);

CREATE INDEX output_templates_is_active_idx ON public.output_templates USING btree (is_active);

CREATE INDEX password_reset_tokens_token_idx ON public.password_reset_tokens USING btree (token);

CREATE INDEX password_reset_tokens_user_id_idx ON public.password_reset_tokens USING btree (user_id);

CREATE INDEX platform_settings_history_version_idx ON public.platform_settings_history USING btree (version DESC);

CREATE INDEX project_files_project_id_idx ON public.project_files USING btree (project_id);

CREATE INDEX project_knowledge_project_id_idx ON public.project_knowledge USING btree (project_id);

CREATE INDEX projects_user_id_idx ON public.projects USING btree (user_id);

CREATE INDEX releases_active_idx ON public.releases USING btree (is_active);

CREATE INDEX system_prompts_active_idx ON public.system_prompts USING btree (is_active);

CREATE UNIQUE INDEX system_prompts_single_active_idx ON public.system_prompts USING btree (is_active) WHERE (is_active = true);

CREATE INDEX tool_error_logs_created_idx ON public.tool_error_logs USING btree (created_at DESC);

CREATE INDEX tool_error_logs_tool_name_idx ON public.tool_error_logs USING btree (tool_name);

CREATE INDEX tool_policies_provider_idx ON public.tool_policies USING btree (provider);

CREATE UNIQUE INDEX tool_policies_provider_tool_name_idx ON public.tool_policies USING btree (provider, tool_name);

CREATE INDEX usage_summary_snapshots_user_generated_at_idx ON public.usage_summary_snapshots USING btree (user_id, generated_at);

CREATE INDEX usage_summary_snapshots_user_id_idx ON public.usage_summary_snapshots USING btree (user_id);

CREATE INDEX user_api_keys_user_id_idx ON public.user_api_keys USING btree (user_id);

ALTER TABLE ONLY public.admin_audit_logs
    ADD CONSTRAINT admin_audit_logs_actor_user_id_users_id_fk FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.admin_audit_logs
    ADD CONSTRAINT admin_audit_logs_target_user_id_users_id_fk FOREIGN KEY (target_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.assistants
    ADD CONSTRAINT assistants_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.cron_jobs
    ADD CONSTRAINT cron_jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.knowledge_items
    ADD CONSTRAINT knowledge_items_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_chat_id_chats_id_fk FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.oauth_tokens
    ADD CONSTRAINT oauth_tokens_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.platform_settings_history
    ADD CONSTRAINT platform_settings_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.pro_coupon_redemptions
    ADD CONSTRAINT pro_coupon_redemptions_coupon_id_pro_coupons_id_fk FOREIGN KEY (coupon_id) REFERENCES public.pro_coupons(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.pro_coupon_redemptions
    ADD CONSTRAINT pro_coupon_redemptions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.project_files
    ADD CONSTRAINT project_files_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.project_knowledge
    ADD CONSTRAINT project_knowledge_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.reactions
    ADD CONSTRAINT reactions_message_id_messages_id_fk FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.reactions
    ADD CONSTRAINT reactions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.releases
    ADD CONSTRAINT releases_published_by_user_id_users_id_fk FOREIGN KEY (published_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.releases
    ADD CONSTRAINT releases_system_prompt_id_system_prompts_id_fk FOREIGN KEY (system_prompt_id) REFERENCES public.system_prompts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.system_prompts
    ADD CONSTRAINT system_prompts_activated_by_user_id_users_id_fk FOREIGN KEY (activated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.system_prompts
    ADD CONSTRAINT system_prompts_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.usage_metrics
    ADD CONSTRAINT usage_metrics_chat_id_chats_id_fk FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.usage_metrics
    ADD CONSTRAINT usage_metrics_message_id_messages_id_fk FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.usage_metrics
    ADD CONSTRAINT usage_metrics_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.usage_summary_snapshots
    ADD CONSTRAINT usage_summary_snapshots_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_api_keys
    ADD CONSTRAINT user_api_keys_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

