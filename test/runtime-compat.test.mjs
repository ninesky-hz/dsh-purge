import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
 GIT_SHIM_MARK,
 GIT_SHIM_NAME,
 ensureRuntimeGitShim,
 gitShimBody,
 resolveSystemGit,
 runtimeGitShimStatus,
} from '../lib/runtime-compat.js';

function fixture(platform='win32') {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'purge git shim 中文 '));
 const resources=path.join(root,'resources'),bin=path.join(resources,'runtime','bin');
 fs.mkdirSync(bin,{recursive:true});
 const gitExe=path.join(root,'Git','cmd','git.exe');
 fs.mkdirSync(path.dirname(gitExe),{recursive:true});
 fs.writeFileSync(gitExe,'fixture git');
 const env={ProgramFiles:path.join(root,'none'),PATH:''};
 return {root,resources,bin,gitExe,env,opts:{resources,gitPath:gitExe,platform,env,fs}};
}

test('writes a forwarding git.cmd pointing at the resolved git and stays idempotent',()=>{
 const f=fixture();try {
  const first=ensureRuntimeGitShim(f.opts);
  assert.equal(first.ok,true);
  assert.equal(first.wrote,true);
  const target=path.join(f.bin,GIT_SHIM_NAME);
  assert.equal(first.target,target);
  const body=fs.readFileSync(target,'utf8');
  assert.equal(body,gitShimBody(path.normalize(f.gitExe)));
  assert.match(body,new RegExp(GIT_SHIM_MARK));
  assert.ok(body.includes('\r\n'),'cmd 文件必须是 CRLF');
  assert.equal(ensureRuntimeGitShim(f.opts).already,true);
  assert.equal(runtimeGitShimStatus(f.opts).state,'ok');
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});

test('a bare forwarder to the same git is adopted instead of treated as foreign',()=>{
 const f=fixture();try {
  const target=path.join(f.bin,GIT_SHIM_NAME);
  fs.writeFileSync(target,`@echo off\r\n"${f.gitExe}" %*\r\n`);
  assert.equal(runtimeGitShimStatus(f.opts).state,'legacy');
  const result=ensureRuntimeGitShim(f.opts);
  assert.equal(result.ok,true);
  assert.equal(result.adopted,true);
  assert.match(fs.readFileSync(target,'utf8'),new RegExp(GIT_SHIM_MARK));
  assert.equal(runtimeGitShimStatus(f.opts).state,'ok');
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});

test('a foreign git.cmd is preserved and reported as conflict instead of overwritten',()=>{
 const f=fixture();try {
  const target=path.join(f.bin,GIT_SHIM_NAME);
  fs.writeFileSync(target,'@echo off\r\necho user-owned\r\n');
  const result=ensureRuntimeGitShim(f.opts);
  assert.equal(result.ok,false);
  assert.equal(result.reason,'file_conflict');
  assert.equal(fs.readFileSync(target,'utf8'),'@echo off\r\necho user-owned\r\n');
  assert.equal(runtimeGitShimStatus(f.opts).state,'conflict');
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});

test('missing system git fails closed without writing a broken shim',()=>{
 const f=fixture();try {
  const opts={...f.opts,gitPath:'',env:{PATH:''},discoverProgramFiles:false};
  const result=ensureRuntimeGitShim(opts);
  assert.equal(result.ok,false);
  assert.equal(result.reason,'missing_system_git');
  assert.equal(fs.existsSync(path.join(f.bin,GIT_SHIM_NAME)),false);
  assert.equal(runtimeGitShimStatus(opts).state,'missing');
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});

test('non-desktop and non-windows hosts are skipped without touching disk',()=>{
 const f=fixture();try {
  assert.equal(ensureRuntimeGitShim({...f.opts,platform:'linux'}).skipped,'not_win32');
  assert.equal(runtimeGitShimStatus({...f.opts,platform:'linux'}).state,'not_win32');
  assert.equal(ensureRuntimeGitShim({...f.opts,resources:path.join(f.root,'absent')}).skipped,'no_runtime');
  assert.equal(fs.existsSync(path.join(f.bin,GIT_SHIM_NAME)),false);
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});

test('resolveSystemGit prefers an explicit path and never picks a git.cmd forwarder',()=>{
 const f=fixture();try {
  assert.equal(path.normalize(resolveSystemGit(f.opts)),path.normalize(f.gitExe));
  const binWithCmd=path.join(f.root,'bin');
  fs.mkdirSync(binWithCmd,{recursive:true});
  fs.writeFileSync(path.join(binWithCmd,'git.cmd'),gitShimBody(f.gitExe));
  assert.equal(resolveSystemGit({platform:'win32',env:{PATH:binWithCmd},fs,discoverProgramFiles:false}),'');
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
