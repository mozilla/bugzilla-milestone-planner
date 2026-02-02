Update the project with the following:

1) Remove the skill based time penalties and task assignment code. This should allow you to simplify a lot so carefully go through the code and clean up things. @task-languages.json can go as well. Similar for the tables at the end out the output and any relevant sections in ERRORS.md.

2) Remove manual size estimates file size-estimates.json. Default to unknown tasks taking 2 weeks, but list them in the ERRORS output at the end, and color them appropriately in the graph. This can keep a section on the bottom with the missing info, and it should probably include the bug title as well.

3) Make sure we can add fractional times to the Bugzilla whiteboard, so [size=3.5] is understood and handled appropriately.

4) We added a new engineer that is only available 20% of the time, so scale their completion times for the tasks appropriately. Check that this calculation is working correctly, add tests to the testsuite.

5) Update JOB_SCHEDULING.md with any changes that seem appropriate now that the problem has been simplified and anything you have learned in the mean time. Don't do the algorithmic changes yet, just note them down.

6) Update CLAUDE.md and write out SPEC2.md which is an updated SPEC.md with the added/removed/changed requirements.
