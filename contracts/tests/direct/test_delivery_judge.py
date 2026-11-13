import json

SPEC = "Return a JSON list of 3 sources about Kite AI, each with a url and a one-line summary."
GOOD = '[{"url":"https://docs.gokite.ai","summary":"Docs"},{"url":"https://gokite.ai","summary":"Home"},{"url":"https://x.com/GoKiteAI","summary":"X"}]'
BAD = "lorem ipsum"


def open_case(c, case_id="c1", deliverable=GOOD, first="ACCEPT"):
    c.open_case(case_id, SPEC, deliverable, "pay-0xabc", first, "fast judge says so")


def test_open_and_read(direct_vm, direct_deploy, direct_alice):
    c = direct_deploy("contracts/delivery_judge.py")
    direct_vm.sender = direct_alice
    open_case(c)
    got = c.get_case("c1")
    assert got["status"] == "open"
    assert got["final_verdict"] == ""
    assert got["first_pass_verdict"] == "ACCEPT"
    assert c.get_stats()["total"] == 1


def test_duplicate_and_bad_input_revert(direct_vm, direct_deploy, direct_alice):
    c = direct_deploy("contracts/delivery_judge.py")
    direct_vm.sender = direct_alice
    open_case(c)
    with direct_vm.expect_revert("case already exists"):
        open_case(c)
    with direct_vm.expect_revert("first_pass_verdict"):
        c.open_case("c2", SPEC, GOOD, "p", "MAYBE", "")
    with direct_vm.expect_revert("spec empty"):
        c.open_case("c3", "", GOOD, "p", "ACCEPT", "")


def test_resolve_accept(direct_vm, direct_deploy, direct_alice):
    c = direct_deploy("contracts/delivery_judge.py")
    direct_vm.sender = direct_alice
    open_case(c)
    direct_vm.mock_llm(r".*impartial arbiter.*", json.dumps({"verdict": "ACCEPT", "reason": "3 sources with urls"}))
    c.resolve("c1")
    got = c.get_case("c1")
    assert got["status"] == "resolved"
    assert got["final_verdict"] == "ACCEPT"
    assert c.get_stats()["accepted"] == 1


def test_resolve_reject_despite_first_pass(direct_vm, direct_deploy, direct_alice):
    c = direct_deploy("contracts/delivery_judge.py")
    direct_vm.sender = direct_alice
    open_case(c, deliverable=BAD, first="ACCEPT")
    direct_vm.mock_llm(r".*impartial arbiter.*", json.dumps({"decision": "rejected", "explanation": "not a list"}))
    c.resolve("c1")
    got = c.get_case("c1")
    assert got["final_verdict"] == "REJECT"  # key aliasing + normalization
    assert c.get_stats()["rejected"] == 1


def test_resolve_twice_and_unknown(direct_vm, direct_deploy, direct_alice):
    c = direct_deploy("contracts/delivery_judge.py")
    direct_vm.sender = direct_alice
    open_case(c)
    direct_vm.mock_llm(r".*impartial arbiter.*", json.dumps({"verdict": "ACCEPT", "reason": "ok"}))
    c.resolve("c1")
    with direct_vm.expect_revert("already resolved"):
        c.resolve("c1")
    with direct_vm.expect_revert("unknown case"):
        c.resolve("nope")


def test_llm_garbage_reverts(direct_vm, direct_deploy, direct_alice):
    c = direct_deploy("contracts/delivery_judge.py")
    direct_vm.sender = direct_alice
    open_case(c)
    direct_vm.mock_llm(r".*impartial arbiter.*", json.dumps({"verdict": "banana"}))
    with direct_vm.expect_revert("LLM_ERROR"):
        c.resolve("c1")
    assert c.get_case("c1")["status"] == "open"
