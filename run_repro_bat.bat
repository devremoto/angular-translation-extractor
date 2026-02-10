@echo off
echo Starting...
where node
node -v
node out\reproduce_issue.js
echo Done %errorlevel%
