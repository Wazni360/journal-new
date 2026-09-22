"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { hasPendingUploads, startUploadManager, subscribeUploads } from "@/lib/uploader";

// Starts the upload manager on every signed-in page and warns before the tab closes while anything is unverified.
const UploadBoot = () => {
  const pathname = usePathname();
  const pending = useSyncExternalStore(subscribeUploads, hasPendingUploads, () => false);

  useEffect(() => {
    if (pathname !== "/login") startUploadManager();
  }, [pathname]);

  useEffect(() => {
    if (!pending) return;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  return null;
};

export default UploadBoot;
