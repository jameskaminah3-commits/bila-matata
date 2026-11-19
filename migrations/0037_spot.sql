-- Where the customer is: "Table 5", "Room 12", "Chair 2". It comes from the
-- code they scanned (/q/<business>?spot=…, or /c/<business>?spot=…), is kept
-- on their chat while it lasts, and is written on the orders and requests
-- they make from there, so the team brings it to them without asking for an
-- address. Short, plain text only (checked before it is stored).
alter table chat_sessions add column spot text check (spot is null or char_length(spot) between 1 and 40);
alter table orders add column spot text check (spot is null or char_length(spot) between 1 and 40);
alter table leads add column spot text check (spot is null or char_length(spot) between 1 and 40);
