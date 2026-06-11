import { Button } from "@carbon/react";
import { LuBlocks } from "react-icons/lu";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";

type CreateAssemblyInstructionProps = {
  itemId: string;
  modelUploadId: string;
  name: string;
};

/**
 * Posts to the new-instruction action with the item's processed model
 * preselected and redirects to the assembly instruction editor.
 */
const CreateAssemblyInstruction = ({
  itemId,
  modelUploadId,
  name
}: CreateAssemblyInstructionProps) => {
  const fetcher = useFetcher<{}>();

  return (
    <fetcher.Form method="post" action={path.to.newAssemblyInstruction}>
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="modelUploadId" value={modelUploadId} />
      <input type="hidden" name="itemId" value={itemId} />
      <Button
        type="submit"
        variant="secondary"
        leftIcon={<LuBlocks />}
        isLoading={fetcher.state !== "idle"}
        isDisabled={fetcher.state !== "idle"}
      >
        Create Assembly Instruction
      </Button>
    </fetcher.Form>
  );
};

export default CreateAssemblyInstruction;
