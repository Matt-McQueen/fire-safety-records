import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { removeResource } from "../../lib/api";
import { Button } from "../ui/Button";
import { ApiErrorAlert } from "../ui/primitives";

/** The "delete this record" button, confirmation prompt, and failure
 * display used by detail pages whose resource refuses deletion while
 * related records exist (equipment and escape routes both refuse it
 * while a check history remains - the API enforces that, not this
 * component, which only surfaces whatever it says). */
export function ResourceDeleteButton({
  path,
  id,
  confirmMessage,
  onDone,
}: {
  path: string;
  id: number;
  confirmMessage: string;
  onDone: () => void;
}) {
  const [error, setError] = useState<unknown>(null);
  const mutation = useMutation({
    mutationFn: () => removeResource(path, id),
    onSuccess: onDone,
    onError: setError,
  });
  return (
    <div>
      {Boolean(error) && <ApiErrorAlert error={error} />}
      <Button
        variant="danger"
        loading={mutation.isPending}
        onClick={() => {
          if (confirm(confirmMessage)) mutation.mutate();
        }}
      >
        Delete
      </Button>
    </div>
  );
}
