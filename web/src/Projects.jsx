// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
import { useState, useEffect, useRef } from "react";
import { FolderPlus, Folder, FileText, Paperclip, Loader2, Trash2, Download } from "lucide-react";
import { uploadFile } from "./lib/upload.js";
import { useT } from "./lib/i18n.jsx";
import config from "./config.js";

const STRINGS = {
  pt: {
    title: "Projetos",
    projectNamePlaceholder: "Nome do projeto",
    newProject: "Novo",
    myProjects: "Meus Projetos",
    noProjects: "Nenhum projeto encontrado.",
    projectFiles: "Arquivos do Projeto",
    attachFile: "Anexar arquivo",
    noFiles: "Nenhum arquivo anexado.",
    selectProjectHint: "Selecione um projeto para gerenciar os arquivos",
    deleteProject: "Excluir projeto",
    deleteConfirm: "Excluir este projeto e todos os seus arquivos? Esta ação não pode ser desfeita.",
    download: "Baixar arquivo",
  },
  en: {
    title: "Projects",
    projectNamePlaceholder: "Project name",
    newProject: "New",
    myProjects: "My Projects",
    noProjects: "No projects found.",
    projectFiles: "Project Files",
    attachFile: "Attach file",
    noFiles: "No files attached.",
    selectProjectHint: "Select a project to manage its files",
    deleteProject: "Delete project",
    deleteConfirm: "Delete this project and all its files? This cannot be undone.",
    download: "Download file",
  },
  es: {
    title: "Proyectos",
    projectNamePlaceholder: "Nombre del proyecto",
    newProject: "Nuevo",
    myProjects: "Mis Proyectos",
    noProjects: "No se encontraron proyectos.",
    projectFiles: "Archivos del Proyecto",
    attachFile: "Adjuntar archivo",
    noFiles: "Ningún archivo adjunto.",
    selectProjectHint: "Selecciona un proyecto para gestionar sus archivos",
    deleteProject: "Eliminar proyecto",
    deleteConfirm: "¿Eliminar este proyecto y todos sus archivos? Esta acción no se puede deshacer.",
    download: "Descargar archivo",
  },
};

export default function Projects({ supabase }) {
  const t = useT(STRINGS);
  const [projects, setProjects] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [files, setFiles] = useState([]);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    async function fetchProjects() {
      try {
        const { data, error } = await supabase
          .from("mz_projects")
          .select("id,name,description,created_at")
          .order("created_at", { ascending: false });
        if (!error && data) setProjects(data);
      } catch (err) {
        console.error("Error fetching projects:", err);
      }
    }
    fetchProjects();
  }, [supabase]);

  async function handleCreateProject() {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    setCreating(true);
    try {
      const { data, error } = await supabase
        .from("mz_projects")
        .insert({ name: trimmedName })
        .select("id,name,description,created_at")
        .single();

      if (!error && data) {
        setProjects([data, ...projects]);
        setName("");
      }
    } catch (err) {
      console.error("Error creating project:", err);
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteProject(id, e) {
    if (e) e.stopPropagation();
    if (!window.confirm(t.deleteConfirm)) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(`${config.SUPABASE_URL}/functions/v1/mz-workspace`, {
        method: "POST",
        headers: { apikey: config.ANON_KEY, Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_project", project_id: id }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      if (selectedId === id) { setSelectedId(null); setFiles([]); }
    } catch (err) {
      console.error("Error deleting project:", err);
    }
  }

  async function selectProject(id) {
    setSelectedId(id);
    try {
      const { data, error } = await supabase
        .from("mz_project_files")
        .select("id,file_name,storage_path,created_at")
        .eq("project_id", id)
        .order("created_at", { ascending: false });
      if (!error && data) setFiles(data);
    } catch (err) {
      console.error("Error fetching files:", err);
    }
  }

  // Baixa um arquivo do projeto. Pede ao mz-workspace uma signed URL FRESCA (URLs assinadas expiram — não dá p/
  // guardar). Arquivos-blob voltam signed_url (append &download p/ forçar Content-Disposition attachment mesmo
  // cross-origin api-zero→zero); arquivos só-texto voltam content_text e o download vira um Blob local.
  async function handleDownloadFile(file, e) {
    if (e) e.stopPropagation();
    setDownloadingId(file.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(`${config.SUPABASE_URL}/functions/v1/mz-workspace`, {
        method: "POST",
        headers: { apikey: config.ANON_KEY, Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sign_file", file_id: file.id }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const name = data.file_name || file.file_name || "download";
      const a = document.createElement("a");
      if (data.signed_url) {
        const sep = data.signed_url.includes("?") ? "&" : "?";
        a.href = `${data.signed_url}${sep}download=${encodeURIComponent(name)}`;
        a.rel = "noopener";
        document.body.appendChild(a); a.click(); a.remove();
      } else if (data.content_text != null) {
        const url = URL.createObjectURL(new Blob([data.content_text], { type: "text/plain;charset=utf-8" }));
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      } else {
        throw new Error(data.error || "sem conteúdo");
      }
    } catch (err) {
      console.error("Error downloading file:", err);
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    setUploading(true);
    try {
      const { path, error: uploadError } = await uploadFile(supabase, file);
      if (uploadError) throw uploadError;

      const { data, error: dbError } = await supabase
        .from("mz_project_files")
        .insert({ 
          project_id: selectedId, 
          file_name: file.name, 
          storage_path: path 
        })
        .select("id,file_name,storage_path,created_at")
        .single();

      if (!dbError && data) {
        setFiles([data, ...files]);
      }
    } catch (err) {
      console.error("Error uploading file:", err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 text-foreground">
      <header className="flex shrink-0 flex-col gap-3">
        <h1 className="text-2xl font-bold text-foreground">{t.title}</h1>
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.projectNamePlaceholder}
            className="flex-1 border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <button
            onClick={handleCreateProject}
            disabled={creating}
            className="bg-teal-600 text-white rounded-md px-3 py-2 text-sm hover:bg-teal-700 disabled:opacity-60 flex items-center gap-2 transition-colors"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderPlus className="w-4 h-4" />}
            {t.newProject}
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-3">
        <div className="flex min-h-0 flex-col gap-2">
          <h2 className="shrink-0 text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">{t.myProjects}</h2>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
            {projects.map((project) => (
              <div
                key={project.id}
                className={`group flex items-center gap-1 rounded-xl border transition-all ${
                  selectedId === project.id
                    ? "bg-teal-50 border-teal-200 ring-1 ring-teal-200 dark:bg-teal-500/10 dark:border-teal-500/30"
                    : "bg-card border-border hover:border-slate-300 dark:hover:border-white/20"
                }`}
              >
                <button
                  onClick={() => selectProject(project.id)}
                  className={`flex min-w-0 flex-1 items-center gap-3 p-3 text-left text-sm font-medium ${selectedId === project.id ? "text-teal-700 dark:text-teal-300" : "text-muted-foreground"}`}
                >
                  <Folder className={`w-4 h-4 shrink-0 ${selectedId === project.id ? "text-teal-600" : "text-muted-foreground"}`} />
                  <span className="truncate">{project.name}</span>
                </button>
                <button
                  onClick={(e) => handleDeleteProject(project.id, e)}
                  title={t.deleteProject}
                  aria-label={t.deleteProject}
                  className="mr-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground/60 transition hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ))}
            {projects.length === 0 && <p className="text-sm text-muted-foreground px-1">{t.noProjects}</p>}
          </div>
        </div>

        <div className="flex min-h-0 flex-col md:col-span-2">
          {selectedId ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="flex shrink-0 items-center justify-between">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{t.projectFiles}</h2>
                <div className="flex items-center gap-2">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="bg-teal-600 text-white rounded-md px-3 py-2 text-sm hover:bg-teal-700 disabled:opacity-60 flex items-center gap-2 transition-colors"
                  >
                    {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
                    {t.attachFile}
                  </button>
                </div>
              </div>

              <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-2 overflow-y-auto pr-1">
                {files.map((file) => (
                  <div
                    key={file.id}
                    className="group flex min-w-0 items-center gap-3 p-3 rounded-xl border border-border bg-card text-sm text-foreground"
                  >
                    <FileText className="w-4 h-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{file.file_name}</span>
                    <button
                      onClick={(e) => handleDownloadFile(file, e)}
                      disabled={downloadingId === file.id}
                      title={t.download}
                      aria-label={t.download}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border bg-background text-muted-foreground transition hover:border-teal-300 hover:bg-teal-500/10 hover:text-teal-600 disabled:opacity-50 focus-visible:text-teal-600"
                    >
                      {downloadingId === file.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
                    </button>
                  </div>
                ))}
                {files.length === 0 && <p className="text-sm text-muted-foreground text-center py-8 border border-dashed border-border rounded-xl">{t.noFiles}</p>}
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-1 items-center justify-center border border-dashed border-border rounded-xl p-12 text-muted-foreground text-sm">
              {t.selectProjectHint}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
