### Enterprise Project Planner specification

## Source data

# Bugzilla

Bugzilla is the main repository for project information. You can use the links below to fetch bugs and look at all the dependent bug trees.

Bugzilla's API documentate is here:
https://bugzilla.readthedocs.io/en/stable/api/index.html
https://wiki.mozilla.org/Bugzilla:REST_API

# Project Milestones

Name, timing and master bug

Foxfooding, Februari 23rd, https://bugzilla.mozilla.org/show_bug.cgi?id=1980342
Customer Pilot, March 30th, https://bugzilla.mozilla.org/show_bug.cgi?id=2012055
MVP, September 15th, https://bugzilla.mozilla.org/show_bug.cgi?id=1980739

Feature freeze for QA 1 week before deadline, so development should finish before then.

# Task Size

Found in Bugzilla whiteboard, format [size=x], where x is

Score   Engineer time
1	    1 day
2	    1 week
3	    2 weeks
4	    4 weeks
5	    12 weeks

Bugs with a missing size estimate should be listed, you can add your own estimate as to the engineering complexity as an additional JSON in the source, but it should be marked in the output that these are not human verified.

# Engineering availability & assignment

Janika Neuberger, JS & Rust
Alexandre Lissy, C++, Rust, JS
Gian-Carlo Pascutto, C++, Rust, JS
Jonathan Mendez, C++, JS, Rust

For bugs with a missing assignee, you can esimate effort (task size) increases by 25% for their second language, and by 50% for their third language. Some coloring in programmer assignment to show those mismatches would be nice. You can map tasks to the likely required languages in a JSON that you add in the source.

The JSON can provide for inputting (un)availability, for example during holidays.

## Required output

# Calculated planning

After reconstructing the bug dependency graph, and calculating the task to language and missing size/effort to bug mappings, you should write JS code that recalculates a planning on the fly, and show the solution as a Gantt style graph on a webpage.

You can generate a greedy, fast schedule on the fly and try to calculcate the globally optimal schedule in the background.

# Output

The output of this project is a single webpage, with supporting JSON that is included, and JavaScript code that calculates the task planning on the fly and graphs the results as a Gantt graph, together with tables of missing/estimated efforts.

# Inconsistencies

If you find any inconsistencies in the bugs, bug graphs, seemingly duplicate bugs, output them as a Markdown formatted ERRORS.md in the project dir.