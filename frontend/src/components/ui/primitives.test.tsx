import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import {
  Alert,
  ApiErrorAlert,
  Badge,
  CenteredSpinner,
  EmptyState,
  PageHeader,
  Pagination,
} from "./primitives";
import { ApiError } from "../../lib/http";

describe("Alert", () => {
  it("renders a title and its children", () => {
    render(
      <Alert tone="warning" title="Careful">
        Something to consider
      </Alert>,
    );
    expect(screen.getByText("Careful")).toBeInTheDocument();
    expect(screen.getByText("Something to consider")).toBeInTheDocument();
  });

  it("renders with no title", () => {
    render(<Alert>Just a message</Alert>);
    expect(screen.getByText("Just a message")).toBeInTheDocument();
  });

  it("gives only errors the alert role", () => {
    // role="alert" interrupts whatever a screen reader is currently saying,
    // which is right for a refusal and wrong for a standing note - so the
    // quieter tones do not claim it.
    //
    // It is also the handle the end-to-end suite aims at. An assertion that
    // searched the whole page for a refusal's wording was being satisfied by a
    // field hint beginning with the same sentence, so it passed whether the API
    // had refused anything or not.
    render(
      <>
        <Alert tone="error" title="Refused" />
        <Alert tone="warning" title="Careful" />
        <Alert tone="info" title="For information" />
        <Alert tone="success" title="Saved" />
      </>,
    );

    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("Refused");
  });
});

describe("ApiErrorAlert", () => {
  it("renders nothing for no error", () => {
    const { container } = render(<ApiErrorAlert error={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a plain Error's message", () => {
    render(<ApiErrorAlert error={new Error("Something broke")} />);
    expect(screen.getByText("Something broke")).toBeInTheDocument();
  });

  it("is reachable by role, which is how the end-to-end suite finds a refusal", () => {
    render(<ApiErrorAlert error={new Error("A notice no longer in force must record why")} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A notice no longer in force must record why",
    );
  });

  it("renders an ApiError's per-field messages", () => {
    const error = new ApiError(400, {
      code: "bad_request",
      message: "The request did not pass validation",
      details: {
        fields: [
          { field: "name", message: "Must not be empty" },
          { field: "town", message: "Must be a string" },
        ],
      },
    });
    render(<ApiErrorAlert error={error} />);
    expect(screen.getByText("The request did not pass validation")).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText(/Must not be empty/)).toBeInTheDocument();
    expect(screen.getByText("town")).toBeInTheDocument();
  });

  it("falls back to a generic message for something that is not an Error", () => {
    render(<ApiErrorAlert error={"a plain string"} />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });
});

describe("Badge", () => {
  it("renders its children", () => {
    render(<Badge tone="green">OK</Badge>);
    expect(screen.getByText("OK")).toBeInTheDocument();
  });
});

describe("CenteredSpinner", () => {
  it("renders an optional label", () => {
    render(<CenteredSpinner label="Loading…" />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders with no label", () => {
    const { container } = render(<CenteredSpinner />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("renders the title, an optional message and an optional action", () => {
    render(
      <EmptyState
        title="Nothing here"
        message="Try a different filter"
        action={<button>Reset</button>}
      />,
    );
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.getByText("Try a different filter")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
  });
});

describe("PageHeader", () => {
  it("renders the title, description and a breadcrumb trail", () => {
    render(
      <MemoryRouter>
        <PageHeader
          title="Equipment"
          description="Everything in service"
          breadcrumb={[{ label: "Home", to: "/" }, { label: "Equipment" }]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Equipment" })).toBeInTheDocument();
    expect(screen.getByText("Everything in service")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    // The final breadcrumb item has no link.
    expect(screen.queryByRole("link", { name: "Equipment" })).not.toBeInTheDocument();
  });

  it("renders actions alongside the title", () => {
    render(
      <MemoryRouter>
        <PageHeader title="Equipment" actions={<button>Add</button>} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });
});

describe("Pagination", () => {
  it("reports the range shown and disables Previous on the first page", () => {
    render(<Pagination limit={10} offset={0} total={25} onChange={() => {}} />);
    expect(screen.getByText(/Showing/)).toHaveTextContent("Showing 1–10 of 25");
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("disables Next on the last page", () => {
    render(<Pagination limit={10} offset={20} total={25} onChange={() => {}} />);
    expect(screen.getByText(/Showing/)).toHaveTextContent("Showing 21–25 of 25");
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("calls onChange with the next or previous offset", async () => {
    const onChange = vi.fn();
    render(<Pagination limit={10} offset={10} total={35} onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onChange).toHaveBeenCalledWith(20);

    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("assumes there may be a next page when the total is not yet known", () => {
    render(<Pagination limit={10} offset={0} total={undefined} onChange={() => {}} />);
    expect(screen.getByText("Page 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });
});
