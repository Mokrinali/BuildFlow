"use client";

import { useActionState } from "react";
import { Button, Field, FormMessage } from "@/components/ui";
import { initialActionState } from "@/server/action-state";
import { createProjectAction, updateProjectAction } from "./actions";

export function ProjectForm({
  project,
}: {
  project?: { id: string; name: string; address: string };
}) {
  const action = project ? updateProjectAction : createProjectAction;
  const [state, formAction, pending] = useActionState(action, initialActionState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {project && <input type="hidden" name="projectId" value={project.id} />}
      <Field
        label="სახელი"
        name="name"
        required
        defaultValue={project?.name}
        error={state.fieldErrors?.name}
      />
      <Field
        label="ობიექტის მისამართი"
        name="address"
        required
        defaultValue={project?.address}
        error={state.fieldErrors?.address}
      />
      <FormMessage ok={state.ok} message={state.message} />
      <Button type="submit" disabled={pending}>
        {project ? "შენახვა" : "პროექტის შექმნა"}
      </Button>
    </form>
  );
}
