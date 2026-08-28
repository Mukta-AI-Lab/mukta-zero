// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
/**
 * Mukta Zero - File Utility Module
 * Provides functionality to read files as text and upload them to Supabase Storage.
 */

/**
 * Reads the content of a File object as a UTF-8 string.
 * 
 * @param {File} file - The file object to be read.
 * @returns {Promise<string>} A promise that resolves with the text content of the file.
 * @throws {Error} If the FileReader encounters an error.
 */
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);

    reader.readAsText(file);
  });
}

/**
 * Uploads a file to the 'mz-uploads' bucket in Supabase Storage.
 * The filename is sanitized and prefixed with a timestamp to avoid collisions.
 * 
 * @param {Object} supabase - The initialized Supabase client instance.
 * @param {File} file - The file object to upload.
 * @returns {Promise<{path: string, error: Error|null}>} Object containing the storage path and any error encountered.
 */
export async function uploadFile(supabase, file) {
  // Sanitize filename: replace any character that is not alphanumeric, dot, underscore, or hyphen with '_'
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  
  // Create a unique path using current timestamp to prevent overwriting files with the same name
  const path = Date.now() + '_' + safe;

  try {
    const { error } = await supabase.storage
      .from('mz-uploads')
      .upload(path, file, { upsert: false });

    return { path, error: error || null };
  } catch (err) {
    return { path, error: err };
  }
}