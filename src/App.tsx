import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FluentProvider, webLightTheme, webDarkTheme, makeStyles, tokens } from "@fluentui/react-components";

import { useConnection, useEventLog, useToolboxEvents } from "./hooks/useToolboxAPI";
import { dvService } from "./services/dataverseService";
import { ViewModel } from "./model/viewModel";
import { ViewStudio } from "./components/viewStudio";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    backgroundColor: tokens.colorNeutralBackground1,
    overflow: "hidden",
  },
  header: {
    padding: tokens.spacingVerticalL,
    paddingBottom: tokens.spacingVerticalS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  headerTitle: {
    display: "flex",
    alignItems: "baseline",
    gap: tokens.spacingHorizontalM,
  },
  subtitle: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase300,
  },
  toolbar: {
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    padding: tokens.spacingVerticalS,
  },
  content: {
    flex: 1,
    overflow: "auto",
    padding: tokens.spacingVerticalL,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
  },
  topRowContainer: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: tokens.spacingVerticalL,
    alignItems: "stretch",
  },
  connectionStatus: {
    minHeight: "0",
    height: "100%",
  },
  toolboxApi: {
    minHeight: "0",
    height: "100%",
  },
});

function App() {
  const { connections, refreshConnection } = useConnection();
  const { addLog } = useEventLog();
  const [theme, setTheme] = React.useState<"light" | "dark">("light");
  const styles = useStyles();

  // Handle platform events
  const handleEvent = useCallback(
    (event: string, _data: any) => {
      switch (event) {
        case "connection:updated":
        case "connection:created":
          refreshConnection();
          break;

        case "connection:deleted":
          refreshConnection();
          break;

        case "terminal:output":
        case "terminal:command:completed":
        case "terminal:error":
          // Terminal events handled by dedicated components
          break;
        case "settings:updated":
          if (_data && _data.theme) {
            document.body.setAttribute("data-theme", _data.theme);
            document.body.setAttribute("data-ag-theme-mode", _data.theme);
            setTheme(_data.theme);
          }
            break;
        default:
          addLog(`Unhandled event: ${event}`, "warning");
          break;
      }
    },
    [refreshConnection, addLog],
  );

  useToolboxEvents(handleEvent);

  // Add initial log (run only once on mount)
  useEffect(() => {
    (async () => {
      const currentTheme = await window.toolboxAPI.utils.getCurrentTheme();
      document.body.setAttribute("data-theme", currentTheme);
      document.body.setAttribute("data-ag-theme-mode", currentTheme);
      setTheme(currentTheme);
    })();
    addLog("ViewStudio initialized", "success");
  }, [addLog]);

  // Get theme from Toolbox API
  useEffect(() => {
    const getTheme = async () => {
      try {
        const currentTheme = await window.toolboxAPI.utils.getCurrentTheme();
        setTheme(currentTheme === "dark" ? "dark" : "light");
      } catch (error) {
        console.error("Error getting theme:", error);
      }
    };
    getTheme();
  }, []);
  const [vm] = useState(() => new ViewModel());
  const connectionServices = useMemo(() => connections.map((connection, slot) =>
    connection ? new dvService({
      connection,
      dvApi: window.dataverseAPI,
      onLog: addLog,
      connectionTarget: slot,
    }) : null,
  ), [connections, addLog]);
  const notifyError = useCallback((message: string) => {
    void window.toolboxAPI.utils.showNotification({
      title: "ViewStudio error",
      body: message,
      type: "error",
    });
  }, []);

  const notifySuccess = useCallback((message: string) => {
    void window.toolboxAPI.utils.showNotification({
      title: "ViewStudio",
      body: message,
      type: "success",
    }).catch((error: unknown) => {
      addLog(`Unable to show success notification: ${error instanceof Error ? error.message : String(error)}`, "error");
    });
  }, [addLog]);

  return (
    <FluentProvider theme={theme === "dark" ? webDarkTheme : webLightTheme} className={styles.root} applyStylesToPortals={false}>
      <ViewStudio
        connections={connections}
        connectionServices={connectionServices}
        vm={vm}
        onLog={addLog}
        notifyError={notifyError}
        notifySuccess={notifySuccess}
      />
    </FluentProvider>
  );
}

export default App;
