Current issues with the agent

- Did not automaitcally assign the tasks to a time slot but that is the expectation
- Did not automatically ask for details about the goal and have it broken down into tasks
- the LLM is scheduling the same task on multiple days.


**IMPORTANT POINTS TO SPEAK ABOUT**

LLM's do not know time!


--> Time zone idea
--> time zone stays in user preferences, whenever the user gives the timezone we ave it to the DB and then when system prompt is constructured we retrieve and update it

---- ## Extension of the consistent base

Consistent is a basic base that has a calendar as its core data structure outside of this business domain the abstract contribution could be abasic agent harness that lives on a calendar

use-cases:
-> Project tracking and management for small teams, collaborative features etc
