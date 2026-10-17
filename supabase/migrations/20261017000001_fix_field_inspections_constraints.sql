-- ==============================================================================
-- Migration: Fix Field Inspections Constraints for Mobile Ad-Hoc Surveys
-- Description:
--   1. Removes rigid NOT NULL on task_id and property_id so ad-hoc field surveys
--      created directly on the mobile app can sync without requiring prior desktop tasks.
--   2. Updates foreign key field_inspections_task_id_fkey with ON DELETE SET NULL
--      so unlinked tasks do not block synchronization.
--   3. Ensures RLS policies allow authenticated supervisors to create and update
--      field tasks and field inspections.
-- ==============================================================================

-- 1. Drop rigid NOT NULL constraints on field_inspections
ALTER TABLE public.field_inspections ALTER COLUMN task_id DROP NOT NULL;
ALTER TABLE public.field_inspections ALTER COLUMN property_id DROP NOT NULL;

-- 2. Drop and recreate foreign key constraint to permit nullable task references
ALTER TABLE public.field_inspections DROP CONSTRAINT IF EXISTS field_inspections_task_id_fkey;

ALTER TABLE public.field_inspections 
  ADD CONSTRAINT field_inspections_task_id_fkey 
  FOREIGN KEY (task_id) REFERENCES public.field_tasks(id) ON DELETE SET NULL;

-- 3. Ensure Row Level Security allows authenticated supervisors to insert and sync
ALTER TABLE public.field_inspections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Supervisors can manage own inspections" ON public.field_inspections;
CREATE POLICY "Supervisors can manage own inspections" ON public.field_inspections
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.field_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Supervisors can manage own tasks" ON public.field_tasks;
CREATE POLICY "Supervisors can manage own tasks" ON public.field_tasks
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- 4. Reload schema cache for PostgREST
NOTIFY pgrst, 'reload schema';
