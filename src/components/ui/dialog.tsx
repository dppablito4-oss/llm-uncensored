import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { X } from "lucide-react";
export function Modal({
  title,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  open: boolean;
  onOpenChange: (value: boolean) => void;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="overlay" />
        <DialogPrimitive.Content className="modal">
          <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="muted">
            Configura tu espacio personal.
          </DialogPrimitive.Description>
          <DialogPrimitive.Close className="close" aria-label="Cerrar">
            <X size={18} />
          </DialogPrimitive.Close>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
