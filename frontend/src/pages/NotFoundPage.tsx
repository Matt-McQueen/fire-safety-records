import { Link } from "react-router-dom";
import { EmptyState } from "../components/ui/primitives";
import { Button } from "../components/ui/Button";

export default function NotFoundPage() {
  return (
    <EmptyState
      title="Page not found"
      message="That page does not exist, or you do not have access to it."
      action={
        <Link to="/">
          <Button variant="secondary">Back to dashboard</Button>
        </Link>
      }
    />
  );
}
